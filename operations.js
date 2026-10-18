'use strict';
document.addEventListener('DOMContentLoaded',async()=>{
 const target=document.getElementById('automation-status');if(!target)return;
 try{
  const response=await fetch('./data/automation-status.json',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
  const s=await response.json();if(s.schemaVersion!==1||!['blocked','complete','partial'].includes(s.state)||!Number.isFinite(s.observedAt))throw Error('Invalid status');
  const profiles={market:'giá và danh mục',daily:'nến nghiên cứu và khung đóng',context:'bối cảnh thị trường',ledger:'holder và sổ giao dịch'},scope=profiles[s.profile]?' · '+profiles[s.profile]:'';
  target.textContent=(s.state==='blocked'?'Lịch cập nhật tự động'+scope+' chưa chạy được. Biểu đồ có thể đối chiếu nến gốc cho cặp đang xem; kho nghiên cứu và dữ liệu ví vẫn giữ mốc bản lưu. ':s.state==='partial'?'Lượt tự động'+scope+' chỉ hoàn tất một phần; nhóm dữ liệu lỗi giữ nguyên bản trước. ':'Lượt tự động'+scope+' đã hoàn tất; đọc thời điểm riêng của từng nguồn. ')+'Ghi nhận '+new Date(s.observedAt).toISOString().replace('T',' ').replace('.000Z',' UTC')+'.';
  target.classList.toggle('automation-blocked',s.state!=='complete');
 }catch(error){target.textContent='Chưa kiểm tra được trạng thái lịch tự động. Hãy đọc thời điểm riêng của từng nguồn.';}
});
