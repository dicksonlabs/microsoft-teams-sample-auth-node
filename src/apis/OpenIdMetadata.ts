// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import * as request from "request";
const getPem = require("rsa-pem-from-mod-exp");
const base64url = require("base64url");

// Handles fetching and caching OpenId key metadata
export class OpenIdMetadata {
    private url: string;
    // tslint:disable-next-line:typedef
    private lastUpdated = 0;
    private keys: IKey[];
    private issuer: string;

    constructor(url: string) {
        this.url = url;
    }

    // Get the key data for the given key id
    public getKey(keyId: string, cb: (key: IOpenIdMetadataKey) => void): void {
        // If keys are more than 5 days old, refresh them
        const now = new Date().getTime();
        if (this.lastUpdated < (now - 1000 * 60 * 60 * 24 * 5)) {
            this.refreshCache((err) => {
                if (err) {
                    console.error("Error retrieving OpenId metadata at " + this.url + ", error: " + err.toString());
                    // fall through and return cached key on error
                }

                // Search the cache even if we failed to refresh
                const key = this.findKey(keyId);
                cb(key);
            });
        } else {
            // Otherwise read from cache
          const key = this.findKey(keyId);
            cb(key);
        }
    }

    // Get the expected issuer template.
    // The string will contain a "{tenantid}" placeholder for the tenant id.
    public getIssuer(tenantId: string): string {
        if (!this.issuer) {
            throw new Error("Configuration has not yet been fetched. Call getKey() first to ensure that the configuration is up to date.");
        }
        return this.issuer.replace("{tenantid}", tenantId);
    }

    private refreshCache(cb: (err: Error) => void): void {
        const options: request.Options = {
            method: "GET",
            url: this.url,
            json: true,
        };

        request(options, (err, response, body) => {
            if (!err && (response.statusCode >= 400 || !body)) {
                err = new Error("Failed to load openID config: " + response.statusCode);
            }

            if (err) {
                cb(err);
            } else {
                const openIdConfig = body as IOpenIdConfig;
                this.issuer = openIdConfig.issuer;

                // tslint:disable-next-line:no-shadowed-variable
                const options: request.Options = {
                    method: "GET",
                    url: openIdConfig.jwks_uri,
                    json: true,
                };

                // tslint:disable-next-line:no-shadowed-variable
                request(options, (err, response, body) => {
                    if (!err && (response.statusCode >= 400 || !body)) {
                        err = new Error("Failed to load Keys: " + response.statusCode);
                    }

                    if (!err) {
                        this.lastUpdated = new Date().getTime();
                        this.keys = body.keys as IKey[];
                    }

                    cb(err);
                });
            }
        });
    }

    private findKey(keyId: string): IOpenIdMetadataKey {
        if (!this.keys) {
            return null;
        }

        for (let i = 0; i < this.keys.length; i++) {
            if (this.keys[i].kid === keyId) {
                let key = this.keys[i];

                if (!key.n || !key.e) {
                    // Return null for non-RSA keys
                    return null;
                }

                let modulus = base64url.toBase64(key.n);
                let exponent = key.e;

                return { key: getPem(modulus, exponent), endorsements: key.endorsements } as IOpenIdMetadataKey;
            }
        }

        return null;
    }
}

interface IOpenIdConfig {
    issuer: string;
    authorization_endpoint: string;
    jwks_uri: string;
    id_token_signing_alg_values_supported: string[];
    token_endpoint_auth_methods_supported: string[];
}

interface IKey {
    kty: string;
    use: string;
    kid: string;
    x5t: string;
    n: string;
    e: string;
    x5c: string[];
    endorsements?: string[];
}

export interface IOpenIdMetadataKey {
    key: string;
    endorsements?: string[];
}
