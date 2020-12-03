import net from 'net';
import http from 'http';
import { once } from 'events';
import { URL, URLSearchParams as SearchParams } from 'url';

import {
    apply,
    option as O,
    function as F,
    either as E,
    taskEither as TE,
    readerTaskEither as RTE,
    stateReaderTaskEither as SRTE,
} from 'fp-ts';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import * as R from 'ramda';

import Defer from 'p-defer';

import pino from 'pino';

import {
    box,
} from '../../src/services/index';

import {
    httpProxy,
} from '../../src/services/http';

import * as u from '../../src/utils';

import type { Logging } from '../../src/model';
import type { Service, Basic } from '../../src/config';





type Req = http.ClientRequest;
type IcM = http.IncomingMessage;

type Closing = { close: () => void };

type Ports = Readonly<Record<'proxy' | 'server', number>>;

export type Result <T> = SRTE.StateReaderTaskEither<Ports, Env, Error, T>;

export type TE_ES = TE.TaskEither<Error, string>;

export type Env = Readonly<{
    url: URL;
    logging: Logging;
    flags: ReturnType<typeof genFlags>;
}>;





jest.retryTimes(0);





describe('httpProxy', () => {

    test.each([

        { debug: true },
        {  warn: true },

    ])('short for proxy auth in %p', async opts => {

        const { auth } = genAuth({ username: 'foo', password: 'bar' });

        const service: Service = {
            auth,
            protocol: 'http',
            host: 'localhost',
            port: 0,
        };

        const p = Defer<number>();

        const proxy = httpProxy (service) (genLogging(opts), p.resolve);

        const sub = proxy.subscribe(u.noop);

        const proxyPort = await p.promise;

        const result = await u.run(fetchToString(

            flushHeaders(
                http.request({
                    host: service.host,
                    port: proxyPort,
                    method: 'GET',
                    path: 'http://example.com',
                }),
            ),

        ));

        sub.unsubscribe();

        expect(E.isLeft(result)).toBe(true);

    });

    test('reject non proxy request', async () => {

        const service: Service = {
            protocol: 'http',
            auth: O.none,
            host: 'localhost',
            port: 0,
        };

        const p = Defer<number>();

        const proxy = httpProxy (service) (genLogging(), p.resolve);

        const sub = proxy.subscribe(u.noop);

        const proxyPort = await p.promise;

        const result = await u.run(fetchToString(

            flushHeaders(
                http.request({
                    host: service.host,
                    port: proxyPort,
                    method: 'GET',
                    path: '/wat',
                }),
            ),

        ));

        sub.unsubscribe();

        expect(E.isLeft(result)).toBe(true);

    });

});





describe('httpProxy', () => {

    test.each([

        'http://   foo:bar   @   localhost   /hello   ?   c=world             ',
        'http://  -foo:bar   @   localhost   /hello   ?   c=world  & a & d    ',
        'http://                 localhost   /hello   ?   c=world             ',
        'http://                 localhost   /hello   ?   c=world- & e        ',

    ])('%s', async raw => {

        const url = new URL(R.replace(/ /g, '', raw));
        const flags = genFlags(url.searchParams);
        const logging = genLogging({ debug: flags.d });

        const env: Env = { url, flags, logging };

        const invoke = SRTE.evaluate({ proxy: 0, server: 0 });

        await RTE.run(F.pipe(

            invoke(sequence({
                server: temp.server,
                proxy: temp.proxy,
                REQUEST: temp.REQUEST,
                CONNECT: temp.CONNECT,
            })),

            RTE.map(({ proxy, server, REQUEST, CONNECT }) => ({
                task: TE.sequenceArray([ REQUEST, CONNECT ]),
                close () {
                    proxy.close();
                    server.close();
                },
            })),

            RTE.chain(({ close, task }) => RTE.bracket(
                RTE.of({}),
                F.constant(RTE.fromTaskEither(task)),
                F.constant(RTE.fromIO(close)),
            )),

            RTE.fold(

                error => RTE.fromIO(() => {

                    if (flags.a || flags.e) {
                        return;
                    }

                    expect(error).toBeUndefined();

                }),

                ([ request, connect ]) => RTE.fromIO(() => {

                    const content = readStr(flags.c ?? '');

                    expect(request).toBe(content);
                    expect(connect).toBe(content);

                }),

            ),

        ), env);

    });

});





export const sequence = apply.sequenceS(SRTE.stateReaderTaskEither);

export const flushHeaders = R.tap((req: Req) => req.flushHeaders());

export const queryFrom =
    (url: URL) =>
        (key: string): string | null =>
            url.searchParams.get(key)
;

export const readStr: u.Fn<string> = R.cond([
    [ R.startsWith('-'), R.tail ],
    [   R.endsWith('-'), R.init ],
    [ R.T, R.identity ],
]);

export function fetchToString (req: Req) {

    return u.tryCatchToError(async () => {

        const [ res ] = (await once(req, 'response')) as [ IcM ];

        if (res.statusCode !== 200) {
            throw new Error(`code ${ res.statusCode }`);
        }

        const chunks = await u.collectAsyncIterable(res);

        return Buffer.concat(chunks).toString();

    });

}

export function genAuth ({ username, password }: Basic) {

    const auth = F.pipe(
        O.some(u.eqBasic({ username, password })),
        O.filter(test => test({ username: '', password: '' }) === false),
    );

    const basic = O.chain (F.constant(O.some({ username, password }))) (auth);

    const hasAuth = u.option2B(auth);

    const credentials = u.toBasicCredentials(
        R.join(':', [ username, password ]),
    );

    const headers = {
        ...(hasAuth && { 'Proxy-Authorization': credentials } ),
    };

    return { auth, basic, headers };

}

export function redirect (url: URL, optionPort?: number) {
    const { hostname, port, pathname } = url;
    return `http://${ hostname }:${ optionPort ?? port }${ pathname }`;
}

export function genFlags (search: SearchParams) {

    const a = search.has('a');
    const e = search.has('e');
    const d = search.has('d');
    const c = search.get('c');

    return { a, e, d, c };

}

export function genLogging ({ debug = false, warn = false } = {}): Logging {

    return {

        logger: pino({
            base: null,
            prettyPrint: false,
            enabled: false,
        }),

        logLevel: {
            on: {
                warn, debug,
                trace: false, info: false,
                error: false, fatal: false,
                silent: false,
            } as const,
        },

    };

}

export const temp = u.run(function () {

    const REQUEST: Result<TE_ES> = ports => ({ url }) => {

        const { headers } = genAuth(url);

        return TE.of(F.tuple(fetchToString(
            flushHeaders(
                http.request({
                    headers,
                    host: url.hostname,
                    port: ports.proxy,
                    method: 'GET',
                    path: redirect(url, ports.server),
                }),
            ),
        ), ports));

    };



    const CONNECT: Result<TE_ES> = ports => ({ url }) => {

        const { headers } = genAuth(url);

        return TE.of(F.tuple(F.pipe(

            u.tryCatchToError(() => {

                const req = flushHeaders(
                    http.request({
                        headers,
                        host: url.hostname,
                        port: ports.proxy,
                        method: 'CONNECT',
                        path: R.join(':', [ url.hostname, ports.server ]),
                    }),
                );

                return once(req, 'connect');

            }),

            TE.map(R.nth(1)),

            TE.chain((conn: net.Socket) => fetchToString(
                flushHeaders(
                    http.request(redirect(url, ports.server), {
                        createConnection: F.constant(conn),
                    }),
                ),
            )),

        ), ports));

    };



    const proxy: Result<Closing> = ports => ({ url, logging, flags }) => {

        const trimAuth: typeof genAuth = R.o(
            genAuth,
            R.evolve({
                username: readStr,
                password: readStr,
            }),
        );

        const { auth } = trimAuth(url);
        const update = R.assoc('proxy', R.__, ports);

        const service: Service = {
            auth,
            protocol: R.init(url.protocol) as Service['protocol'],
            host: url.hostname,
            port: ports.proxy,
        };

        return u.tryCatchToError(async () => {

            const { resolve, promise } = Defer<number>();

            const source = box (service) (logging, resolve);

            const dispose = new Rx.Subject<boolean>();

            const close = R.once(() => {
                dispose.next(true);
            });

            source.pipe(

                o.mergeMap(({ host, port, hook }) => {

                    if (flags.e) {
                        return hook();
                    }

                    return hook(net.connect({ host, port }));

                }),

                o.takeUntil(dispose),

            ).subscribe({ error: close });

            return F.tuple({ close }, update(await promise));

        });

    };



    const server: Result<Closing> = ports => ({ url, flags }) => {

        const update = R.assoc('server', R.__, ports);

        return TE.fromTask(async () => {

            const { resolve, promise } = Defer<number>();

            const ser = http.createServer((req, res) => {

                if (req.method === 'GET' && req.url === url.pathname) {
                    res.writeHead(200);
                    res.write(flags.c ?? '');
                    res.end();
                }

                req.resume();

            });

            ser.listen({ port: ports.server, host: url.hostname }, () => {

                const address = ser.address() ?? '';
                resolve(typeof address === 'string' ? 0 : address.port);

                ser.unref();

            });

            return F.tuple(ser, update(await promise));

        });

    };



    return { proxy, server, REQUEST, CONNECT };

});

