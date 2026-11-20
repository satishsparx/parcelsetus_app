import mongoose from 'mongoose';

const connectionCache = (globalThis.parcelsetusMongoConnection ??= {
  connection: null,
  promise: null,
});

export async function connectToDatabase() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required to start the API.');
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET)
    throw new Error('SESSION_SECRET is required in production.');

  if (connectionCache.connection?.readyState === 1) return connectionCache.connection;

  if (!connectionCache.promise) {
    connectionCache.promise = mongoose
      .connect(process.env.MONGODB_URI)
      .then(() => {
        connectionCache.connection = mongoose.connection;
        return connectionCache.connection;
      })
      .catch(error => {
        connectionCache.promise = null;
        throw error;
      });
  }

  return connectionCache.promise;
}

export async function databaseConnectionMiddleware(_req, _res, next) {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
}
