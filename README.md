# Flow Research — Public Market Observatory

Giao diện web quan sát dữ liệu thị trường công khai. Kho này **không chứa bộ chiến lược riêng** và không phải hệ thống giao dịch tự động.

## Phần đã có

- `index.html`, `style.css`, `app.js`: giao diện tối, phù hợp máy tính và điện thoại; bảng dữ liệu, sắp xếp, bản đồ lực mua và biểu đồ chi tiết.
- Đọc các endpoint công khai Binance Spot theo yêu cầu; không cần API key, không kết nối ví, không đặt lệnh.
- Tính thống kê mô tả: biến động giá 7/30 ngày, tỷ trọng taker mua 7 ngày, giá trị giao dịch bình quân 20 ngày.
- Loại nến chưa đóng, kiểm tra ngày thiếu và dữ liệu cũ; hiển thị lỗi truy cập thay vì điền dữ liệu giả.
- Chỉ gửi yêu cầu tới nguồn khi người dùng bấm cập nhật. Không chạy nền, không lưu danh sách người dùng vào GitHub.

## Phần chưa có

Không có công thức xếp hạng riêng, bộ backtest của v0.2, nhãn ví cá mập, lịch sử nắm giữ, backend private, đăng nhập hoặc bằng chứng chiến lược có lợi nhuận. Không diễn giải thống kê taker thành danh tính nhà đầu tư.

## Xuất bản bằng GitHub Pages

Mã đã được đưa lên nhánh `main`. Lần kiểm tra sau khi tải mã, repository vẫn báo `has_pages: false`; website chưa được bật.

Chủ kho mở [Settings → Pages](https://github.com/Phuongdinh92/flow-research/settings/pages), chọn:

- Source: **Deploy from a branch**.
- Branch: **main**; thư mục **/(root)**.
- Bấm **Save**, sau đó chờ GitHub báo xuất bản thành công và cung cấp nút **Visit site**.

`.nojekyll` cho phép phục vụ trực tiếp các tệp tĩnh. Không cần tải ZIP hay cài Python để sử dụng website sau khi Pages xuất bản.

## Ranh giới công khai và riêng tư

Mọi tệp trong repository public và mọi HTML/CSS/JavaScript/JSON gửi tới trình duyệt đều có thể bị xem hoặc sao chép. Public không phải một biện pháp bảo vệ sở hữu trí tuệ. Kho private cũng không làm mã đã gửi tới trình duyệt trở thành bí mật.

Công thức xếp hạng, tham số chiến lược, dữ liệu nghiên cứu, nhãn ví riêng, khóa truy cập và danh mục cá nhân phải để ngoài kho này. Bộ nghiên cứu riêng cần một kho private và backend có xác thực, kiểm tra quyền phía máy chủ; backend đó **chưa được triển khai**.

`.gitignore` chỉ giảm rủi ro thêm nhầm tệp khi dùng Git thông thường, không chặn được upload thủ công hay bảo vệ tệp đã commit. Thẻ `noindex` không phải kiểm soát truy cập. Không dùng mật khẩu trong JavaScript để giả lập bảo mật.

Không cấp thêm giấy phép nguồn mở. Việc công khai vẫn cho phép người khác xem/fork theo chức năng và điều khoản GitHub; thông báo này không thể ngăn sao chép.

## Kiểm tra phiên bản này

17 kiểm tra tính toán và dữ liệu đạt; 10 kiểm tra DOM/giao diện offline đạt, bao gồm trạng thái trống, xử lý dữ liệu mô phỏng, sắp xếp, chi tiết mã, màn hình 390 px và lỗi 429. Dữ liệu mô phỏng chỉ dùng trong môi trường kiểm thử, không được đưa vào website.

Kiểm tra DOM chạy trong bộ nhớ với `fetch` giả lập; không phải kiểm thử CSP, API thật hoặc website đã xuất bản. Kết nối API thật từ môi trường xây dựng thất bại ở bước phân giải DNS. Cần kiểm tra nguồn dữ liệu thực tế sau khi xuất bản. Không có kết quả backtest hay cam kết lợi nhuận.

## Tài liệu nguồn

- [Binance: Market Data Only URLs](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
- [Binance: Klines và market endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market)
- [GitHub: Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub: Licensing a repository](https://docs.github.com/articles/licensing-a-repository)
