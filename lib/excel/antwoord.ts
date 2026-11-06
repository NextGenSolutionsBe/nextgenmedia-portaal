import 'server-only'
import { NextResponse } from 'next/server'

/** Het HTTP-antwoord voor een .xlsx-download, met een veilige bestandsnaam. */
export function xlsxAntwoord(buffer: Buffer, bestandsnaam: string, mime: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${bestandsnaam.replace(/[^ -~]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(bestandsnaam)}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
      'X-Bestandsnaam': encodeURIComponent(bestandsnaam),
    },
  })
}
