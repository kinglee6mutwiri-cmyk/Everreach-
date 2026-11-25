const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.static('.'));
const FILE='users.json';
if(!fs.existsSync(FILE)) fs.writeFileSync(FILE,'{}');
function getUsers(){ return JSON.parse(fs.readFileSync(FILE)); }
app.post('/api/signup',(req,res)=>{
  const {email,password}=req.body;
  const u=getUsers();
  if(u[email]) return res.json({error:'Account exists'});
  u[email]=password; fs.writeFileSync(FILE, JSON.stringify(u));
  res.json({ok:true});
});
app.post('/api/login',(req,res)=>{
  const {email,password}=req.body;
  const u=getUsers();
  if(u[email]===password) return res.json({ok:true});
  res.json({error:'Wrong email or password'});
});
app.listen(3000,()=>console.log('YOUR SERVER RUNNING ON 3000 - NO SUPABASE'));
