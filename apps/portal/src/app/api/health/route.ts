export async function GET() {
  return Response.json({
    service: "operatus-portal",
    status: "ok",
    authority: "local-node",
    time: new Date().toISOString(),
  });
}
