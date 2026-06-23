import { NextRequest } from "next/server";

const RELAYER_URL = process.env.RELAYER_URL ?? "http://127.0.0.1:8080";

async function forward(req: NextRequest, path: string[]) {
  const suffix = path.join("/");
  const search = req.nextUrl.search;
  const target = `${RELAYER_URL}/${suffix}${search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
  };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.text();
  const upstream = await fetch(target, init);
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path);
}
