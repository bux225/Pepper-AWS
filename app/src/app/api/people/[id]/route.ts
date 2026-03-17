import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithDocs } from '@/lib/people';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const personId = parseInt(id, 10);
  if (isNaN(personId)) {
    return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });
  }

  const person = getPersonWithDocs(personId);
  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 });

  return NextResponse.json(person);
}
