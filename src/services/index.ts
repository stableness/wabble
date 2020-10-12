import * as Rx from 'rxjs';

import type { Logging } from '../model';
import type { Service, Config } from '../config';

import { httpProxy } from './http';
import { socks5Proxy } from './socks5';





type Proxy = ReturnType<typeof httpProxy | typeof socks5Proxy>;

export type Hook = Rx.ObservedValueOf<ReturnType<Proxy>>['hook'];





export const combine = (logging: Logging) => (services: Config['services']) => {

    const { length, 0: head } = services;

    if (length === 1) {
        return box (head) (logging);
    }

    return Rx.merge(...services.map(service => box (service) (logging)));

};





export function box (service: Service) {

    const { protocol } = service;

    if (protocol === 'http') {
        return httpProxy(service);
    }

    if (protocol === 'socks5') {
        return socks5Proxy(service);
    }

    throw new Error(`Non supported protocol [${ protocol }]`);

}

