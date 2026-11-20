import 'dotenv/config';
import app from './app.js';
import { connectToDatabase } from './config/database.js';

const port = Number(process.env.PORT || 4000);

connectToDatabase()
  .then(() => {
    app.listen(port, () => console.log(`ParcelSetus API listening on http://localhost:${port}`));
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
