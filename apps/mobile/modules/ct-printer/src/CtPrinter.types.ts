/** 单个文本绘制项（坐标单位：mm；scale 1~10 放大倍数） */
export interface CtTextOp {
  xMm: number;
  yMm: number;
  scale: number;
  text: string;
}

/** 单张标签：一个二维码 + 若干文本，打印 copies 份 */
export interface CtLabel {
  qr: string;
  copies: number;
  texts: CtTextOp[];
}

/** 一次打印任务（一种规格矩阵的多张标签） */
export interface CtPrintJob {
  widthMm: number;
  heightMm: number;
  dpi: number;
  qrXMm: number;
  qrYMm: number;
  qrCell: number;
  labels: CtLabel[];
}

/** 已配对蓝牙设备 */
export interface CtBondedDevice {
  name: string;
  mac: string;
}

export type CtPort = "SPP" | "BLE";
