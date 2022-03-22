require('dotenv').config();

async function connect() {
  if (global.connection){
    return global.connection;
  }
  const { Pool } = require('pg');
  const pool = new Pool({
    user: process.env.POSTGRESQL_USER,
    host: process.env.POSTGRESQL_HOST,
    database: process.env.POSTGRESQL_DATA,
    password: process.env.POSTGRESQL_PASS,
    port: process.env.POSTGRESQL_PORT
  });

  const client = await pool.connect();
  // console.log('Pool de conexão criado.');
  // const res = await client.query('SELECT NOW()');
  // console.log(res.rows[0]);  

  client.release();
  global.connection = pool.connect();
  return global.connection;
};

module.exports = { connect }
