import { createCustomer, listCustomers } from "@/lib/db";
import type { CreateCustomerInput } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await listCustomers({
    search: url.searchParams.get("search") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  return Response.json(result);
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as CreateCustomerInput;
    const customer = await createCustomer(input);
    return Response.json({ customer }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "สร้างลูกค้าไม่สำเร็จ";
    return Response.json({ error: message }, { status: 400 });
  }
}
