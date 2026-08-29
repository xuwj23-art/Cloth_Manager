import ImagePicker from "react-native-image-crop-picker";

/**
 * 商品图取图统一入口（建档/编辑共用）：
 * - 系统相册（真实相册分区：相机/截屏/收藏等，微信式体验）
 * - 内置裁剪器（自由比例裁剪 + 90° 旋转 + 缩放），fixOrientation 修 EXIF 旋转
 * - 压缩到 1600px / 72% 质量，控制上传体积
 * 返回可直接上传的 file:// uri；用户取消抛 code=E_PICKER_CANCELLED。
 */
const CROP_OPTS = {
  cropping: true,
  freeStyleCropEnabled: true,
  fixOrientation: true,
  compressImageMaxWidth: 1600,
  compressImageMaxHeight: 1600,
  compressImageQuality: 0.72,
  cropperToolbarTitle: "调整图片",
  cropperActiveWidgetColor: "#2563EB",
  cropperToolbarColor: "#101E3C",
  cropperStatusBarColor: "#101E3C",
  cropperToolbarWidgetColor: "#FFFFFF",
  showCropGuidelines: true,
} as const;

export async function pickProductImage(fromCamera: boolean): Promise<string> {
  const img = fromCamera
    ? await ImagePicker.openCamera({ ...CROP_OPTS })
    : await ImagePicker.openPicker({ ...CROP_OPTS });
  return img.path.startsWith("file://") ? img.path : `file://${img.path}`;
}

export function isPickerCancelled(e: unknown): boolean {
  return (e as { code?: string })?.code === "E_PICKER_CANCELLED";
}
