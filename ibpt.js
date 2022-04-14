const db = require('./db');

(async () => {  
  const states = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];  
  try {
    for ( const state of states ) {
      const client = await db.connect();
      const res = await client.query(`
        SELECT ncm_id, cest_code, sigla FROM erp.erp.tabelao_test4 
        WHERE           
          sigla = '${state}'          
        GROUP BY sigla, ncm_id, cest_code
      `);
      
      console.log(res.rows);
    }
  } catch(err) {
    console.log(err.message);
  }
})();


