
## 📄 `Caro-Server/README.md`

```md
# Caro Server

Backend cho game Caro online realtime.

## Clone project

```bash
git clone https://github.com/ducyen0811/Caro-Server.git
cd Caro-Server
Cài đặt
npm install
Tạo file .env
PORT=4000
DATABASE_URL="file:./dev.db"
JWT_SECRET=secret
CLIENT_URL=http://localhost:3000
Setup database
npx prisma generate
npx prisma db push
Chạy server
npm run dev

Server chạy tại:

http://localhost:4000
Frontend
https://github.com/ducyen0811/Caro-Client
