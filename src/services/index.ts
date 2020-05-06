import * as Rx from 'rxjs';

import type { Service } from '../config';

import { httpProxy } from './http';
import { socks5Proxy } from './socks5';





type Proxy = typeof httpProxy | typeof socks5Proxy;

export type Hook = Rx.ObservedValueOf<ReturnType<Proxy>>['hook'];





export function combine (services: readonly Service[]) {

    const { length, 0: head } = services;

    if (length < 1) {
        throw new Error('No service to provide');
    }

    if (length === 1) {
        return box(head);
    }

    return Rx.merge(...services.map(box));

}





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

