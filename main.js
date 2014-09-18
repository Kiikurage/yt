var request = require("request"),
    fs = require("fs"),
    exec = require("child_process").exec;

var VideoFilePath = "./.tmp";

var Color = {
    Red: "\x1b[1;35m",
    Green: "\x1b[1;32m",
    Yellow: "\x1b[1;33m",
    Blue: "\x1b[1;34m",
    Normal: "\x1b[m"
};

function createVideoPageUrl(videoId) {
    return "https://www.youtube.com/watch?v=" + videoId;
}

function downloadVideoPage(videoId) {
    var videoUrl = createVideoPageUrl(videoId),
        defer = Promise.defer();

    request.get(createVideoPageUrl(videoId), function(err, res, body) {
        if (err) {
            defer.reject(err);
        } else {
            defer.resolve(body);
        }
    });

    return defer.promise;
}

function parseVideoPage(html) {
    var regConfig = /ytplayer.config = ({.*?});/,
        regTitle = /<title>([^<]*)<\/title>/;

    var maConfig = html.match(regConfig),
        maTitle = html.match(regTitle);

    if (!maConfig) {
        throw new Error("ytplayer.config is not found.");
    }

    var config = JSON.parse(maConfig[1]),
        title = maTitle[1].replace(" - YouTube", "");

    var urlEncodedFormatStreamMap = config.args.url_encoded_fmt_stream_map.split(","),
        formatStreamMap = urlEncodedFormatStreamMap.map(function(encodedStream) {
            var stream = decodeURLParams(encodedStream);
            stream.type = stream.type.split(";")[0];

            return stream;
        });

    return {
        title: title,
        streams: formatStreamMap
    };
};

function decodeURLParams(encoded) {
    var params = encoded.split("&"),
        result = {};

    params.forEach(function(param) {
        var keyVal = param.split("=");
        result[keyVal[0]] = decodeURIComponent(keyVal[1]);
    });

    return result;
}

function findStreamByType(streams, type) {
    for (var i = 0, max = streams.length; i < max; i++) {
        if (streams[i].type !== type) continue;
        return streams[i];
    }
    return null;
};

function showProgressGage(percent) {
    var maxColumns = process.stdout.columns - 5,
        gageColumns = parseInt(maxColumns * percent / 100),
        spaceColumns = maxColumns - gageColumns;

    var gage = new Array(gageColumns + 1).join("#"),
        space = new Array(spaceColumns + 1).join("."),
        label = ("  " + percent).substr(-3) + "%";

    console.log(
        Color.Blue + gage + Color.Normal +
        space +
        " " + label
    );
}

function convertVideoToMP3(outputPath) {
    process.stdout.write(
        "\n" +
        Color.Green + "Convert " + Color.Normal + "\n" +
        Color.Red + "input " + Color.Normal +
        VideoFilePath + "\n" +
        Color.Red + "output " + Color.Normal +
        outputPath + "\n"
    );

    exec("ffmpeg -i " + VideoFilePath + " " + outputPath.replace(/ /g, "\\ "), function(err) {
        process.stdout.write(
            "done.\n"
        );
        process.stdout.write(
            "\n" +
            Color.Green + "CleanUp " + Color.Normal + "\n"
        );
        exec("rm " + VideoFilePath, function() {
            process.stdout.write(
                "done.\n\n"
            );
        })
    });
}

var videoId = process.argv[2];

if (!videoId) {
    throw new Error("Invalid videoID.");
}
if (videoId.substr(0, 4) === "http") {
    videoId = videoId.match(/v=([^&]+)/)[1];
}

downloadVideoPage(videoId)
    .then(function(html) {
        return parseVideoPage(html);
    })
    .then(function(res) {
        var stream =
            findStreamByType(res.streams, "video/mp4") ||
            findStreamByType(res.streams, "video/x-flv") ||
            null;

        if (!stream) {
            throw new Error("Can't find available stream.");
        }

        stream.title = res.title;

        process.stdout.write(
            "\n" +
            Color.Green + "StreamInfo " + Color.Normal + "\n" +
            Color.Red + "title " + Color.Normal +
            stream.title + "\n" +
            Color.Red + "url " + Color.Normal +
            stream.url + "\n"
        );
        return stream;
    })
    .then(function(streamInfo) {
        var stream = request(streamInfo.url),
            completeSize = 0,
            percent = -1,
            maxSize;

        stream
            .pipe(fs.createWriteStream(VideoFilePath));


        stream.once("data", function() {
            process.stdout.write(
                "\n" +
                Color.Green + "Download " + Color.Normal +
                "\n" +
                "\n"
            );
            maxSize = Number(stream.response.headers["content-length"]);
        });

        stream.on("data", function(buf) {
            completeSize += buf.length;
            var _percent = parseInt(completeSize / maxSize * 100);

            if (_percent > percent) {
                percent = _percent;
                process.stdout.write("\x1b[1A\x1bJ")
                showProgressGage(percent);
            }
        });

        stream.on("end", function() {
            convertVideoToMP3("./" + streamInfo.title + ".mp3");
        });
    })
    .catch(function(err) {
        console.error(err);
    });
