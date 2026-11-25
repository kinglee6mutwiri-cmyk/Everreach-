
// EARNINGS ENGINE - Partner pays, we share. No fixed promise.
// You (admin) set these when partner company confirms rate.
// Until you set them, user earns 0 - no fake money.
const PARTNER_RATES = {
  watch_ad: 0,        // Set when partner confirms, e.g. 5
  complete_task: 0,   // Set when partner confirms, e.g. 50
  survey: 0,          // Set when partner confirms
  invite_friend: 0,   // Set when partner confirms
  daily_checkin: 0
};
// Admin: update rates here when partner pays: PARTNER_RATES.watch_ad = 5
function getEarnings(){ try{ return JSON.parse(localStorage.getItem('everreach_earnings') || '[]'); }catch(e){ return []; } }
function getBalance(){ return getEarnings().reduce((sum, x)=> sum + (x.amount||0), 0); }
function addEarning(type, proof){
  if(!proof){ console.log('No proof, no pay'); return 0; }
  let amount = PARTNER_RATES[type] || 0;
  if(amount <= 0){ alert('Partner rate not set yet for this work. No pay until partner confirms.'); return getBalance(); }
  let list = getEarnings();
  if(list.some(x=>x.proof===proof)){ alert('Already paid for this work.'); return getBalance(); }
  list.push({type, amount, proof, time: new Date().toISOString()});
  localStorage.setItem('everreach_earnings', JSON.stringify(list));
  updateBalanceUI();
  return getBalance();
}
function updateBalanceUI(){
  let bal = getBalance();
  let el = document.getElementById('balanceAmount');
  if(el) el.textContent = 'KSh ' + bal.toLocaleString('en-KE') + '.00';
  let box = document.getElementById('start-earning');
  if(box){
    if(bal<=0) box.innerHTML = '<b>No earnings yet.</b> Your balance is KSh 0.00. Complete work to earn. Pay is based on what the partner company pays us. Minimum withdrawal is KSh 1,000.';
    else box.innerHTML = '<b>You have earned KSh ' + bal.toLocaleString('en-KE') + ' from real work.</b> Pay is based on partner rate. Keep working to reach KSh 1,000.';
  }
  window.BALANCE = bal;
  return bal;
}
document.addEventListener('DOMContentLoaded', updateBalanceUI);
