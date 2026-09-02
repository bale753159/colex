import { createTransaction, listTransactions } from "@/lib/db";
import type { CreateTransactionInput, TransactionDirection } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const direction = url.searchParams.get("direction");
  const result = listTransactions({
    search: url.searchParams.get("search") ?? undefined,
    direction: direction === "deposit" || direction === "withdraw" ? direction as TransactionDirection : undefined,
    limit: Number(url.searchParams.get("limit") ?? 50),
  });
  return Response.json(result);
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as CreateTransactionInput;
    const result = createTransaction(input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ไม่สามารถบันทึกรายการได้";
    return Response.json({ error: message }, { status: 400 });
  }
}
