import mongoose from 'mongoose';
import {
  resolveMongoConnection,
  UnsafeDatabaseTargetError
} from './databaseTarget.js';

/**
 * Remove any connection string that could appear inside a driver error message.
 * Credentials and full URIs must never reach the logs.
 */
const redactConnectionStrings = (message = '') =>
  String(message).replace(/mongodb(\+srv)?:\/\/\S+/gi, '[redacted-mongodb-uri]');

const connectDB = async () => {
  let target;

  try {
    target = resolveMongoConnection();
  } catch (error) {
    if (error instanceof UnsafeDatabaseTargetError) {
      console.error(`Refusing to start: ${error.message}`);
      process.exit(1);
    }
    console.error(`MongoDB configuration error: ${redactConnectionStrings(error.message)}`);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    return;
  }

  if (!target.uri) {
    console.warn(
      'MongoDB is not configured. Set MONGODB_URI (or MONGODB_URI_TEST with USE_TEST_DATABASE) before starting the server.'
    );
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    return;
  }

  try {
    const conn = await mongoose.connect(target.uri);

    if (target.mode === 'test') {
      // Visible confirmation that the isolated database is active. Only the
      // database name and hostname are printed.
      console.log(
        `MongoDB Connected (TEST DATABASE: ${conn.connection.name}) @ ${conn.connection.host}`
      );
    } else {
      console.log(`MongoDB Connected: ${conn.connection.host}`);
    }
  } catch (error) {
    console.error(`MongoDB Connection Error: ${redactConnectionStrings(error.message)}`);
    // Do not exit process in dev if URI is placeholder, allow server to run for static endpoints or friendly errors
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

export default connectDB;
