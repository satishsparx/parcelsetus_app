import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import { User } from './models.js';

const router = Router();
const google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const hashToken = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform(v => v.toLowerCase());
const passwordSchema = z.string().min(10).max(128);
const publicUser = user => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  mobile: user.mobile,
  businessName: user.businessName,
  accountType: user.accountType,
  emailVerified: Boolean(user.emailVerifiedAt),
  authProviders: user.authProviders || [],
});

async function sendLink({ to, subject, title, link }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    if (process.env.NODE_ENV !== 'production') return { developmentLink: link };
    throw new Error('Email delivery is not configured.');
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: `${title}\n\nOpen this link to continue: ${link}\n\nThis link expires in 30 minutes. If you did not request it, you can ignore this email.`,
  });
  return {};
}

function startSession(req, user) {
  return new Promise((resolve, reject) =>
    req.session.regenerate(error => {
      if (error) return reject(error);
      req.session.userId = user.id;
      req.session.sessionVersion = user.sessionVersion || 0;
      req.session.save(saveError => (saveError ? reject(saveError) : resolve()));
    }),
  );
}

router.post('/register', async (req, res, next) => {
  try {
    const schema = z.object({
      fullName: z.string().trim().min(2).max(100),
      email: emailSchema,
      mobile: z.string().trim().max(20).optional().default(''),
      password: passwordSchema,
      businessName: z.string().trim().max(120).optional().default(''),
      accountType: z.enum(['Individual', 'Business']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: 'Check the highlighted fields and try again.',
        fields: parsed.error.flatten().fieldErrors,
      });
    const input = parsed.data;
    if (await User.exists({ email: input.email }))
      return res.status(409).json({
        error: 'An account with this email already exists. Sign in or reset your password.',
      });
    const rawToken = token();
    const user = await User.create({
      ...input,
      authProviders: ['password'],
      passwordHash: await bcrypt.hash(input.password, 12),
      verificationTokenHash: hashToken(rawToken),
      verificationExpiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const link = `${process.env.APP_ORIGIN || 'http://localhost:5173'}/?verify=${encodeURIComponent(rawToken)}`;
    let delivery;
    try {
      delivery = await sendLink({
        to: user.email,
        subject: 'Verify your ParcelSetus email',
        title: 'Verify your ParcelSetus account',
        link,
      });
    } catch (error) {
      await User.deleteOne({ _id: user._id });
      throw error;
    }
    return res.status(201).json({
      message: 'Account created. Check your email for a verification link.',
      email: user.email,
      ...delivery,
    });
  } catch (error) {
    if (error?.code === 11000)
      return res.status(409).json({
        error: 'An account with this email already exists. Sign in or reset your password.',
      });
    next(error);
  }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const rawToken = z.string().min(20).safeParse(req.body?.token);
    if (!rawToken.success)
      return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
    const user = await User.findOne({
      verificationTokenHash: hashToken(rawToken.data),
      verificationExpiresAt: { $gt: new Date() },
    }).select('+verificationTokenHash +verificationExpiresAt +sessionVersion');
    if (!user)
      return res
        .status(400)
        .json({ error: 'This verification link is invalid or has expired. Request a new one.' });
    user.emailVerifiedAt = new Date();
    user.verificationTokenHash = undefined;
    user.verificationExpiresAt = undefined;
    await user.save();
    await startSession(req, user);
    return res.json({ message: 'Email verified. Your account is ready.', user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/resend-verification', async (req, res, next) => {
  try {
    const email = emailSchema.safeParse(req.body?.email);
    if (!email.success) return res.status(400).json({ error: 'Enter a valid email address.' });
    const user = await User.findOne({ email: email.data, emailVerifiedAt: null }).select(
      '+verificationTokenHash +verificationExpiresAt',
    );
    let developmentLink;
    if (user) {
      const rawToken = token();
      user.verificationTokenHash = hashToken(rawToken);
      user.verificationExpiresAt = new Date(Date.now() + 30 * 60_000);
      await user.save();
      try {
        const result = await sendLink({
          to: user.email,
          subject: 'Verify your ParcelSetus email',
          title: 'Verify your ParcelSetus account',
          link: `${process.env.APP_ORIGIN || 'http://localhost:5173'}/?verify=${encodeURIComponent(rawToken)}`,
        });
        developmentLink = result.developmentLink;
      } catch {
        user.verificationTokenHash = undefined;
        user.verificationExpiresAt = undefined;
        await user.save();
        console.error('Verification email delivery failed.');
      }
    }
    res.json({
      message: 'If this address has an unverified account, a new link has been sent.',
      ...(developmentLink ? { developmentLink } : {}),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const parsed = z
      .object({ email: emailSchema, password: z.string().min(1).max(128) })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: 'Enter a valid email and password.' });
    const user = await User.findOne({ email: parsed.data.email }).select(
      '+passwordHash +sessionVersion',
    );
    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(parsed.data.password, user.passwordHash))
    )
      return res.status(401).json({ error: 'The email or password is incorrect.' });
    if (user.status !== 'active')
      return res
        .status(403)
        .json({ error: 'This account is suspended. Contact support for help.' });
    if (!user.emailVerifiedAt)
      return res
        .status(403)
        .json({ code: 'EMAIL_NOT_VERIFIED', error: 'Verify your email before signing in.' });
    await startSession(req, user);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/google', async (req, res, next) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(503).json({ error: 'Google sign-in is not configured yet.' });
    const credential = z.string().min(20).safeParse(req.body?.credential);
    if (!credential.success)
      return res.status(400).json({ error: 'Google sign-in could not be completed. Try again.' });
    const profileResult = z
      .object({
        accountType: z.enum(['Individual', 'Business']).optional().default('Individual'),
        businessName: z.string().trim().max(120).optional().default(''),
        mobile: z.string().trim().max(20).optional().default(''),
      })
      .safeParse(req.body);
    if (!profileResult.success)
      return res.status(400).json({ error: 'Check the account details and try again.' });
    const ticket = await google.verifyIdToken({
      idToken: credential.data,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const claims = ticket.getPayload();
    if (!claims?.sub || !claims.email || claims.email_verified !== true)
      return res.status(401).json({ error: 'Google could not verify this email address.' });
    const email = claims.email.toLowerCase();
    let user = await User.findOne({ $or: [{ googleSubject: claims.sub }, { email }] }).select(
      '+googleSubject +sessionVersion',
    );
    if (user) {
      if (user.status !== 'active')
        return res
          .status(403)
          .json({ error: 'This account is suspended. Contact support for help.' });
      if (user.googleSubject && user.googleSubject !== claims.sub)
        return res.status(409).json({ error: 'This email is linked to another Google account.' });
      user.googleSubject = claims.sub;
      user.authProviders = [...new Set([...(user.authProviders || []), 'google'])];
      user.emailVerifiedAt ||= new Date();
      await user.save();
    } else {
      const profile = profileResult.data;
      user = await User.create({
        fullName: claims.name || claims.given_name || 'ParcelSetus seller',
        email,
        accountType: profile.accountType,
        businessName: profile.businessName,
        mobile: profile.mobile,
        googleSubject: claims.sub,
        authProviders: ['google'],
        emailVerifiedAt: new Date(),
      });
      user.sessionVersion = 0;
    }
    await startSession(req, user);
    res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === 'Error' || error.name === 'GaxiosError')
      return res
        .status(401)
        .json({ error: 'Google sign-in could not be verified. Please try again.' });
    next(error);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = emailSchema.safeParse(req.body?.email);
    if (!email.success) return res.status(400).json({ error: 'Enter a valid email address.' });
    const user = await User.findOne({ email: email.data }).select(
      '+passwordHash +googleSubject +resetTokenHash +resetExpiresAt',
    );
    let developmentLink;
    if (user?.passwordHash || (user && !user.googleSubject)) {
      const rawToken = token();
      user.resetTokenHash = hashToken(rawToken);
      user.resetExpiresAt = new Date(Date.now() + 30 * 60_000);
      await user.save();
      try {
        const result = await sendLink({
          to: user.email,
          subject: 'Reset your ParcelSetus password',
          title: 'Reset your password',
          link: `${process.env.APP_ORIGIN || 'http://localhost:5173'}/?reset=${encodeURIComponent(rawToken)}`,
        });
        developmentLink = result.developmentLink;
      } catch {
        user.resetTokenHash = undefined;
        user.resetExpiresAt = undefined;
        await user.save();
        console.error('Password reset email delivery failed.');
      }
    }
    res.json({
      message: 'If an account exists for this email, password reset instructions have been sent.',
      ...(developmentLink ? { developmentLink } : {}),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const parsed = z
      .object({ token: z.string().min(20), password: passwordSchema })
      .safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Use a valid reset link and a password with at least 10 characters.' });
    const user = await User.findOne({
      resetTokenHash: hashToken(parsed.data.token),
      resetExpiresAt: { $gt: new Date() },
    }).select('+resetTokenHash +resetExpiresAt +sessionVersion');
    if (!user)
      return res.status(400).json({
        error: 'This password reset link is invalid or has expired. Request another one.',
      });
    user.passwordHash = await bcrypt.hash(parsed.data.password, 12);
    user.resetTokenHash = undefined;
    user.resetExpiresAt = undefined;
    user.sessionVersion += 1;
    await user.save();
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

router.post('/link-password', async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in to continue.' });
    const parsed = z.object({ password: passwordSchema }).safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
    const user = await User.findById(req.session.userId).select('+passwordHash +sessionVersion');
    if (
      !user ||
      user.status !== 'active' ||
      !user.emailVerifiedAt ||
      user.sessionVersion !== req.session.sessionVersion
    )
      return res.status(401).json({ error: 'Sign in again to continue.' });
    if (user.passwordHash)
      return res.status(409).json({ error: 'A password is already connected to this account.' });
    user.passwordHash = await bcrypt.hash(parsed.data.password, 12);
    user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
    await user.save();
    res.json({
      message: 'Password sign-in is now connected to your account.',
      user: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in to continue.' });
    const user = await User.findById(req.session.userId).select('+sessionVersion');
    if (
      !user ||
      user.status !== 'active' ||
      !user.emailVerifiedAt ||
      user.sessionVersion !== req.session.sessionVersion
    )
      return res.status(401).json({ error: 'Sign in to continue.' });
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res) =>
  req.session.destroy(() => {
    res.clearCookie('parcelsetus.sid');
    res.status(204).end();
  }),
);

router.post('/logout-all', async (req, res, next) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in to continue.' });
    await User.updateOne({ _id: req.session.userId }, { $inc: { sessionVersion: 1 } });
    req.session.destroy(error => {
      if (error) return next(error);
      res.clearCookie('parcelsetus.sid');
      res.json({ message: 'You have been signed out from all devices.' });
    });
  } catch (error) {
    next(error);
  }
});

export default router;
