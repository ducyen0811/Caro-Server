import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  CLIENT_URL: process.env.CLIENT_URL ?? "http://localhost:3000",
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET ?? "dev_access_secret_change_me",
};