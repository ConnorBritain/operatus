export async function GET() {
  return Response.json({
    service: "ventura-portal",
    status: "ok",
    authority: "local-node",
    time: new Date().toISOString(),
  });
}
