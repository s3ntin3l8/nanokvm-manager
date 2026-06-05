export interface NanoKvmResponse<T> {
  code: number;
  msg: string;
  data: T;
}

/** GET /api/vm/gpio — LED state of the target host. */
export interface GpioState {
  /** Power LED — proxy for "host is powered on". */
  pwr: boolean;
  /** HDD activity LED. */
  hdd: boolean;
}

export interface VmInfoIp {
  name: string;
  addr: string;
  version: string;
  type: string;
}

/** GET /api/vm/info — device identity + network. */
export interface VmInfo {
  ips: VmInfoIp[];
  mdns: string;
  image: string;
  application: string;
  deviceKey: string;
}

/** High-level ATX actions exposed by the dashboard (mapped to gpio type+duration). */
export type PowerAction = 'power' | 'reset' | 'longpress';
