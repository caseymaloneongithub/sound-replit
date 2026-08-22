import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";
import AwsS3 from "@uppy/aws-s3";
import ImageEditor from "@uppy/image-editor";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  // Uppy passes the file here; callers use it to sign the upload with the file's
  // real MIME type/extension instead of assuming one.
  onGetUploadParameters: (file?: { name?: string; type?: string }) => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  /**
   * Lock the crop box to this width/height ratio (1 = square). Leave unset for a free
   * crop. Everywhere the site shows flavor and product photos is a square tile, so
   * callers for those pass 1 and what staff see in the editor is what customers see.
   */
  cropAspectRatio?: number;
  buttonClassName?: string;
  children: ReactNode;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760,
  onGetUploadParameters,
  onComplete,
  cropAspectRatio,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const { toast } = useToast();
  // The Uppy instance is built once, so handlers wired into it would otherwise keep the
  // props from the first render forever — a stale closure that made the flavor page's
  // "complete" handler read empty state. Always call the latest props through refs.
  const latest = useRef({ onGetUploadParameters, onComplete });
  latest.current = { onGetUploadParameters, onComplete };
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes: ['image/*'],
      },
      autoProceed: false,
    })
      // Crop / rotate / flip / zoom before upload. The Dashboard picks this plugin up
      // automatically and shows an "Edit" control on each image.
      .use(ImageEditor, {
        quality: 0.9,
        cropperOptions: {
          viewMode: 1,
          background: false,
          autoCropArea: 1,
          responsive: true,
          aspectRatio: cropAspectRatio ?? NaN,
        },
        actions: {
          revert: true,
          rotate: true,
          granularRotate: true,
          flip: true,
          zoomIn: true,
          zoomOut: true,
          // With a fixed ratio these preset buttons would just fight it.
          cropSquare: cropAspectRatio == null,
          cropWidescreen: cropAspectRatio == null,
          cropWidescreenVertical: cropAspectRatio == null,
        },
      })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: async (file) => {
          const params = await latest.current.onGetUploadParameters(file);
          // Uppy builds `new URL(url)` with no base, so a same-origin relative upload
          // URL ("/api/object-storage/upload/…") throws "Invalid URL" before a single
          // byte is sent — and the failure used to be silent. Resolve it here so callers
          // can keep handing back whatever the server minted.
          return { ...params, url: new URL(params.url, window.location.origin).href };
        },
      })
      .on("upload-error", (file, error) => {
        toast({
          title: "Upload failed",
          description: `${file?.name ?? "Image"}: ${error?.message ?? "unknown error"}`,
          variant: "destructive",
        });
      })
      .on("complete", (result) => {
        latest.current.onComplete?.(result);
        if (result.failed == null || result.failed.length === 0) {
          setShowModal(false);
        }
      })
  );

  useEffect(() => {
    return () => {
      uppy.cancelAll();
    };
  }, [uppy]);

  return (
    <div>
      <Button
        type="button"
        onClick={() => setShowModal(true)}
        className={buttonClassName}
        data-testid="button-upload-photos"
      >
        {children}
      </Button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
        note={cropAspectRatio === 1 ? "Use Edit to crop — photos display as a square tile." : undefined}
      />
    </div>
  );
}
