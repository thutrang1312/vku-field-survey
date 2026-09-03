import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

/**
 * Dịch vụ xử lý chụp ảnh Native bằng Capacitor Camera
 * Tự động fallback sang HTML File/Webcam picker nếu chạy trên trình duyệt thường.
 */
export async function capturePhoto(): Promise<string | null> {
  try {
    const image = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      promptLabelHeader: 'Chụp ảnh minh chứng VKU',
      promptLabelPhoto: 'Chọn từ thư viện',
      promptLabelPicture: 'Chụp ảnh mới',
    });

    return image.dataUrl || null;
  } catch (error) {
    console.warn('[Camera] Không thể mở Capacitor camera, chuyển sang fallback file input:', error);
    return pickPhotoFromFileInput(true);
  }
}

/**
 * Chọn ảnh từ thư viện thiết bị
 */
export async function pickPhotoFromGallery(): Promise<string | null> {
  try {
    const image = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Photos,
    });

    return image.dataUrl || null;
  } catch (error) {
    console.warn('[Camera] Không thể chọn ảnh qua Capacitor, chuyển sang fallback:', error);
    return pickPhotoFromFileInput(false);
  }
}

/**
 * Fallback chọn ảnh qua HTML5 file input
 */
function pickPhotoFromFileInput(useCamera = false): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) {
      input.capture = 'environment';
    }

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };

    input.oncancel = () => resolve(null);
    input.click();
  });
}

