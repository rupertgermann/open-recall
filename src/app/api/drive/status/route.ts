import { resolveGogStatus } from "@/lib/drive/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await resolveGogStatus();
  return Response.json(status);
}
