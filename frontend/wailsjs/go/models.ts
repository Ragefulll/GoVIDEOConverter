export namespace main {
	
	export class FFmpegStatus {
	    installed: boolean;
	    ffmpeg: string;
	    ffprobe: string;
	    version: string;
	    source: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new FFmpegStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.installed = source["installed"];
	        this.ffmpeg = source["ffmpeg"];
	        this.ffprobe = source["ffprobe"];
	        this.version = source["version"];
	        this.source = source["source"];
	        this.message = source["message"];
	    }
	}
	export class ResolutionBitrate {
	    bitrateKbps: number;
	    maxrateKbps: number;
	    bufsizeKbps: number;
	
	    static createFrom(source: any = {}) {
	        return new ResolutionBitrate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bitrateKbps = source["bitrateKbps"];
	        this.maxrateKbps = source["maxrateKbps"];
	        this.bufsizeKbps = source["bufsizeKbps"];
	    }
	}
	export class Settings {
	    resolution: string;
	    resolutions: string[];
	    codec: string;
	    encoder: string;
	    container: string;
	    bitDepth: number;
	    crf: number;
	    bitrateKbps: number;
	    maxrateKbps: number;
	    bufsizeKbps: number;
	    bitrateByResolution: Record<string, ResolutionBitrate>;
	    compressionMode: string;
	    preset: string;
	    throttle: number;
	    removeAudio: boolean;
	    overwrite: boolean;
	    firstScreen: boolean;
	    lastScreen: boolean;
	    allKeyframes: boolean;
	    validateDecode: boolean;
	    outputPrefix: string;
	    outputDirectory: string;
	    ffmpegPath: string;
	    preserveAspectLetter: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resolution = source["resolution"];
	        this.resolutions = source["resolutions"];
	        this.codec = source["codec"];
	        this.encoder = source["encoder"];
	        this.container = source["container"];
	        this.bitDepth = source["bitDepth"];
	        this.crf = source["crf"];
	        this.bitrateKbps = source["bitrateKbps"];
	        this.maxrateKbps = source["maxrateKbps"];
	        this.bufsizeKbps = source["bufsizeKbps"];
	        this.bitrateByResolution = this.convertValues(source["bitrateByResolution"], ResolutionBitrate, true);
	        this.compressionMode = source["compressionMode"];
	        this.preset = source["preset"];
	        this.throttle = source["throttle"];
	        this.removeAudio = source["removeAudio"];
	        this.overwrite = source["overwrite"];
	        this.firstScreen = source["firstScreen"];
	        this.lastScreen = source["lastScreen"];
	        this.allKeyframes = source["allKeyframes"];
	        this.validateDecode = source["validateDecode"];
	        this.outputPrefix = source["outputPrefix"];
	        this.outputDirectory = source["outputDirectory"];
	        this.ffmpegPath = source["ffmpegPath"];
	        this.preserveAspectLetter = source["preserveAspectLetter"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UpdateStatus {
	    current: string;
	    remote: string;
	    status: string;
	    progress: number;
	    detail: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.remote = source["remote"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.detail = source["detail"];
	    }
	}
	export class VideoMetadata {
	    duration: number;
	    width: number;
	    height: number;
	    codec: string;
	    pixelFormat: string;
	    bitrate: number;
	    fps: string;
	    audioCodec: string;
	    format: string;
	    rotation: number;
	    creationTime: string;
	    formatLongName: string;
	    fileSize: number;
	    encoder: string;
	    videoProfile: string;
	    videoLevel: string;
	    avgFps: string;
	    durationVideo: number;
	    bitrateVideo: number;
	    maxBitrate: number;
	    codecTag: string;
	    nbFrames: number;
	    hasBFrames: number;
	    aspectRatio: string;
	    colorSpace: string;
	    colorTransfer: string;
	    colorPrimaries: string;
	    colorRange: string;
	    fieldOrder: string;
	    bitDepth: number;
	    audioSampleRate: number;
	    audioChannels: number;
	    audioChannelLayout: string;
	    audioBitrate: number;
	    audioBitDepth: number;
	    audioDuration: number;
	    audioNbFrames: number;
	    subtitleCodec: string;
	    dataCodec: string;
	    streamCount: number;
	
	    static createFrom(source: any = {}) {
	        return new VideoMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.duration = source["duration"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.codec = source["codec"];
	        this.pixelFormat = source["pixelFormat"];
	        this.bitrate = source["bitrate"];
	        this.fps = source["fps"];
	        this.audioCodec = source["audioCodec"];
	        this.format = source["format"];
	        this.rotation = source["rotation"];
	        this.creationTime = source["creationTime"];
	        this.formatLongName = source["formatLongName"];
	        this.fileSize = source["fileSize"];
	        this.encoder = source["encoder"];
	        this.videoProfile = source["videoProfile"];
	        this.videoLevel = source["videoLevel"];
	        this.avgFps = source["avgFps"];
	        this.durationVideo = source["durationVideo"];
	        this.bitrateVideo = source["bitrateVideo"];
	        this.maxBitrate = source["maxBitrate"];
	        this.codecTag = source["codecTag"];
	        this.nbFrames = source["nbFrames"];
	        this.hasBFrames = source["hasBFrames"];
	        this.aspectRatio = source["aspectRatio"];
	        this.colorSpace = source["colorSpace"];
	        this.colorTransfer = source["colorTransfer"];
	        this.colorPrimaries = source["colorPrimaries"];
	        this.colorRange = source["colorRange"];
	        this.fieldOrder = source["fieldOrder"];
	        this.bitDepth = source["bitDepth"];
	        this.audioSampleRate = source["audioSampleRate"];
	        this.audioChannels = source["audioChannels"];
	        this.audioChannelLayout = source["audioChannelLayout"];
	        this.audioBitrate = source["audioBitrate"];
	        this.audioBitDepth = source["audioBitDepth"];
	        this.audioDuration = source["audioDuration"];
	        this.audioNbFrames = source["audioNbFrames"];
	        this.subtitleCodec = source["subtitleCodec"];
	        this.dataCodec = source["dataCodec"];
	        this.streamCount = source["streamCount"];
	    }
	}
	export class VideoItem {
	    id: string;
	    path: string;
	    name: string;
	    size: number;
	    status: string;
	    progress: number;
	    output: string;
	    error: string;
	    meta: VideoMetadata;
	
	    static createFrom(source: any = {}) {
	        return new VideoItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.output = source["output"];
	        this.error = source["error"];
	        this.meta = this.convertValues(source["meta"], VideoMetadata);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

