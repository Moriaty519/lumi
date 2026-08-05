/**
 * Vercel Serverless 入口：只暴露 /api/* 云端 HTTP。
 * 前端静态资源由 vercel.json 的 outputDirectory (client-dist) 提供。
 */
import app from '../server/appCloud.js';

export default app;
