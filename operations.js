'use strict';
document.addEventListener('DOMContentLoaded',async()=>{
 const target=document.getElementById('automation-status');if(!target)return;
 try{
  const response=await fetch('./data/automation-status.json',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
  const s=await response.json();if(s.schemaVersion!==1||!['blocked','complete','partial'].includes(s.state)||!Number.isFinite(s.observedAt))throw Error('Invalid status');
  target.textContent=s.state==='blocked'?'Lịch cập nhật tự động chưa chạy được. Đang dùng bản lưu có thời điểm nguồn; nút cập nhật giá chỉ làm mới các nguồn hỗ trợ đọc trực tiếp.':(s.state==='partial'?'Lần thu thập tự động gần nhất chỉ hoàn tất một phần; nguồn lỗi giữ bản trước. ':'Lần thu thập tự động gần nhất đã hoàn tất. ')+'Ghi nhận '+new Date(s.observedAt).toISOString().replace('T',' ').replace('.000Z',' UTC')+'.';
  target.classList.toggle('automation-blocked',s.state!=='complete');
 }catch(error){target.textContent='Chưa kiểm tra được trạng thái lịch tự động. Hãy đọc thời điểm riêng của từng nguồn.';}
});
