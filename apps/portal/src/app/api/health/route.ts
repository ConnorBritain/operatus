export async function GET() {
  return Response.json({
    service: "atelier-portal",
    status: "ok",
    authority: "local-node",
    time: new Date().toISOString(),
  });
}
