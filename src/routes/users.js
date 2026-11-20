import { Router } from 'express';
import { User } from '../models/User.js';
import { profileSchema } from '../schemas.js';
import { validate } from '../lib/validate.js';

const router = Router();

router.patch('/profile', async (req, res, next) => {
  try {
    const input = validate(profileSchema, req, res);
    if (!input) return;
    const user = await User.findByIdAndUpdate(req.sellerId, { $set: input }, { new: true });
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        businessName: user.businessName,
        businessAddress: user.businessAddress,
        gstin: user.gstin,
        accountType: user.accountType,
        emailVerified: Boolean(user.emailVerifiedAt),
        authProviders: user.authProviders || [],
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
