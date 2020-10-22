import net from 'net';

import { bind } from 'proxy-bind';

import { asyncReadable } from 'async-readable';

import { fromLong as ipFromLong, toString as ipToString } from 'ip';

import {
    apply,
    option as O,
    taskEither as TE,
    either as E,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import type { Logging } from '../model';
import type { Service } from '../config';

import {
    run,
    pump,
    mountErrOf,
    catchKToError,
    writeToTaskEither,
} from '../utils';

import {
    readFrame,
    do_not_have_authentication,
} from './utils';





const reply = [ 0, 1, 0, 0, 0, 0, 0, 0 ];

const AUTH_NOT  = Uint8Array.from([ 0x05, 0x00 ]);
const AUTH_YES  = Uint8Array.from([ 0x05, 0x02 ]);
const AUTH_ERR  = Uint8Array.from([ 0x01, 0xFF ]);
const AUTH_SUC  = Uint8Array.from([ 0x01, 0x00 ]);
const E_METHOD  = Uint8Array.from([ 0x05, 0xFF ]);
const E_COMMAND = Uint8Array.from([ 0x05, 0x07, ...reply ]);
const E_ATYP    = Uint8Array.from([ 0x05, 0x08, ...reply ]);
const CONTINUE  = Uint8Array.from([ 0x05, 0x00, ...reply ]);





export const socks5Proxy = (service: Service) => (logging: Logging) => {

    const { logLevel, logger } = logging;
    const { auth, port: servicePort, host: serviceHost } = service;

    return new Rx.Observable<net.Socket>(subject => {

        const { next, error, complete } = bind(subject);

        const server = net.createServer()

            .addListener('connection', next)
            .addListener('error', error)
            .addListener('close', complete)

            .listen(servicePort, serviceHost)

        ;

        return function () {

            server

                .removeListener('connection', next)
                .removeListener('error', error)
                .removeListener('close', complete)

                .close()

            ;

        };

    }).pipe(

        o.mergeMap(async socket => {

            const { read: readToPromise } = asyncReadable(socket);

            const read = catchKToError(readToPromise);
            const write = writeToTaskEither(socket);

            const frame = readFrame(readToPromise);
            const frameToString = TE.map (R.toString) (frame);

            const result = await run(F.pipe(

                read(1),

                TE.chain(([ VER ]) =>
                    VER === 0x05 ? frame : TE.leftIO(() => Error(`VER [${ VER }]`)),
                ),

                TE.map<Buffer, number[]>(Array.from),

                TE.chain(methods => {

                    if (O.isNone(auth)) {
                        return write(AUTH_NOT);
                    }

                    if (do_not_have_authentication(methods)) {
                        return F.pipe(
                            write(E_METHOD),
                            TE.chain(leftIOErr(`METHODS [${ methods }]`)),
                        );
                    }

                    return F.pipe(

                        write(AUTH_YES),
                        TE.chain(() => read(1)),
                        TE.chain(([ VER ]) => {

                            if (VER === 0x01) {
                                return readSequenceS({
                                    username: frameToString,
                                    password: frameToString,
                                });
                            }

                            return F.pipe(
                                write(AUTH_ERR),
                                TE.chain(leftIOErr(`VER [${ VER }]`)),
                            );

                        }),

                        TE.chain(info => {

                            if (auth.value(info) === true) {
                                return write(AUTH_SUC);
                            }

                            const { username, password } = info;

                            return F.pipe(
                                write(AUTH_ERR),
                                TE.chain(leftIOErr(`user [${ username }] pass [${ password }]`)),
                            );

                        }),

                    );

                }),

                TE.chain(() => read(4)),

                TE.chain(([ VER, CMD, _, ATYP ]) => {

                    if (VER !== 0x05 || CMD !== 0x01) {
                        return F.pipe(
                            write(E_COMMAND),
                            TE.chain(leftIOErr(`VER [${ VER }] CMD [${ CMD }]`)),
                        );
                    }

                    return TE.right(ATYP);

                }),

                TE.chain(ATYP => {

                    if (ATYP === 1) {
                        return F.pipe(
                            read(4),
                            TE.map(buf => ipFromLong(buf.readUInt32BE(0))),
                        );
                    }

                    if (ATYP === 4) {
                        return F.pipe(
                            read(16),
                            TE.map(ipToString),
                        );
                    }

                    if (ATYP === 3) {
                        return frameToString;
                    }

                    return F.pipe(
                        write(E_ATYP),
                        TE.chain(leftIOErr(`ATYP [${ ATYP }]`)),
                    );

                }),

                TE.bindTo('host'),

                TE.bind('port', () => F.pipe(
                    read(2),
                    TE.map(buf => buf.readUInt16BE(0)),
                )),

                TE.bind('socket', F.constant(TE.right(socket))),

            ));

            if (E.isRight(result)) {
                return result.right;
            }

            if (logLevel.on.debug) {

                logger.debug({
                    msg: 'SOCKS5_HANDSHAKE_ERROR',
                    message: R.propOr('unknown', 'message')(result.left),
                });

            }

            run(write(result.left.message)).finally(() => {
                socket.destroy();
            });

            return F.constUndefined();

        }),

        o.filter(Boolean),

        o.map(({ host, port, socket }) => ({

            host,
            port,

            async hook (...duplex: NodeJS.ReadWriteStream[]) {

                if (R.isEmpty(duplex)) {
                    mountErrOf(socket);
                    return socket.destroy();
                }

                socket.write(CONTINUE);

                await pump(socket, ...duplex, socket);

            },

        })),

    );

};





const readSequenceS = apply.sequenceS(TE.taskEitherSeq);

const leftIOErr = F.flow(
    Error,
    TE.left,
    F.constant,
);

