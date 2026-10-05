import {Line,getProduct} from './catalog';

// In-memory fallback store when running outside Cloudflare (e.g. Vercel / Node serverless)
const fallbackStore = {
  carts: new Map<string, string>(),
  messages: [] as any[],
  subscribers: new Set<string>(),
  checkout_sessions: new Map<string, any>()
};

function createFallbackDb() {
  return {
    prepare(sql: string) {
      let boundArgs: any[] = [];
      const stmt = {
        bind(...args: any[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.includes('SELECT lines FROM carts WHERE id = ?')) {
            const id = boundArgs[0];
            const lines = fallbackStore.carts.get(id);
            return (lines ? { lines } : null) as T | null;
          }
          if (sql.includes('SELECT id FROM checkout_sessions WHERE id = ? AND cart_id = ?')) {
            const sid = boundArgs[0];
            const cid = boundArgs[1];
            const session = fallbackStore.checkout_sessions.get(sid);
            if (session && session.cart_id === cid) {
              return { id: session.id } as T;
            }
            return null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO carts')) {
            const id = boundArgs[0];
            const lines = boundArgs[1];
            fallbackStore.carts.set(id, lines);
          } else if (sql.includes('INSERT INTO messages')) {
            fallbackStore.messages.push({
              id: boundArgs[0],
              name: boundArgs[1],
              email: boundArgs[2],
              message: boundArgs[3],
              created_at: boundArgs[4]
            });
          } else if (sql.includes('INSERT OR IGNORE INTO subscribers')) {
            fallbackStore.subscribers.add(boundArgs[0]);
          } else if (sql.includes('INSERT INTO checkout_sessions')) {
            fallbackStore.checkout_sessions.set(boundArgs[0], {
              id: boundArgs[0],
              cart_id: boundArgs[1],
              status: boundArgs[2],
              created_at: boundArgs[3]
            });
          } else if (sql.includes('UPDATE checkout_sessions SET status = ? WHERE id = ?')) {
            const session = fallbackStore.checkout_sessions.get(boundArgs[1]);
            if (session) {
              session.status = boundArgs[0];
            }
          }
          return { success: true };
        }
      };
      return stmt;
    }
  } as unknown as D1Database;
}

const fallbackDb = createFallbackDb();

export const bindings: {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  COMMERCE_ENABLED?: string;
  RESEND_API_KEY?: string;
  ORDER_EMAIL_FROM?: string;
} = new Proxy({} as any, {
  get(_, prop: string) {
    if (prop === 'DB') {
      const g = globalThis as any;
      if (g.DB) return g.DB;
      if (g.__env__?.DB) return g.__env__.DB;
      return fallbackDb;
    }
    const g = globalThis as any;
    if (g[prop] !== undefined) return g[prop];
    if (g.__env__?.[prop] !== undefined) return g.__env__[prop];
    if (typeof process !== 'undefined' && process.env) {
      return (process.env as any)[prop];
    }
    return undefined;
  }
});

export function database(): D1Database {
  return bindings.DB || fallbackDb;
}

export function json(data:unknown,status=200,headers:Record<string,string>={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}})}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');return !!origin&&origin===new URL(req.url).origin}
export function sessionId(req:Request){const s=req.headers.get('cookie')?.match(/(?:^|;\s*)vyrn_cart=([a-f0-9-]{36})(?:;|$)/)?.[1];return s||null}
export function cookie(id:string,req:Request){return `vyrn_cart=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(req.url).protocol==='https:'?'; Secure':''}`}
export async function readCart(id:string):Promise<Line[]>{const row=await database().prepare('SELECT lines FROM carts WHERE id = ?').bind(id).first<{lines:string}>();if(!row)return [];const parsed=JSON.parse(row.lines);return parsed.filter((l:Line)=>getProduct(l.id))}
export function validLine(l:Line,allowZero=false){const p=getProduct(l?.id);return !!p&&p.sizes.includes(l.size)&&l.color===p.color&&Number.isInteger(l.quantity)&&l.quantity>=(allowZero?0:1)&&l.quantity<=p.stock}
export async function readBody(req:Request){const raw=await req.text();if(raw.length>12000)throw Error('Request too large');return JSON.parse(raw)}
export function paymentReady(){return bindings.COMMERCE_ENABLED==='true'&&!!bindings.STRIPE_SECRET_KEY}
