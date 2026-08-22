import { Module } from "@nestjs/common";
import { DownloadApkService } from "./download-apk.service";
import { DownloadController } from "./download.controller";

@Module({
  controllers: [DownloadController],
  providers: [DownloadApkService],
})
export class DownloadModule {}
