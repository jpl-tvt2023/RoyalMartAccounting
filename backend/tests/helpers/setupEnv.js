// Loaded before every suite: the test env wins over backend/.env, so tests
// can never reach a real database.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test'), override: true });
