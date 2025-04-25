import {HttpsProxyAgent} from "https-proxy-agent";

export const agent = new HttpsProxyAgent( proxy, "127.0.0.1:7890")