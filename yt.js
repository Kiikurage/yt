#!/usr/bin/env node

var request = require('request'),
    fs = require('fs'),
    path = require('path'),
    exec = require('child_process').exec;

var Color = {
    Red: "\x1b[1;35m",
    Green: "\x1b[1;32m",
    Yellow: "\x1b[1;33m",
    Blue: "\x1b[1;34m",
    Blue2: "\x1b[1;36m",
    Normal: "\x1b[m"
};

var yt = {

    MODE: {
        NORMAL: 1,
        ITUNESEARCH: 2
    },

    /**
     *  処理が同時進行した際に、一時ファイルが重複しないための、タイムスタンプ識別子
     *  @type {number}
     *  @final
     */
    TIMESTAMP: Date.now(),

    /**
     *  メタデータが設定されたかどうかのフラグ
     *  @type {string}
     *  @final
     */
    FLAG_METADATA: false,

    /**
     *  ダウンロードするビデオのID
     *  @type {string}
     *  @final
     */
    VIDEO_ID: '',

    /**
     *  ダウンロードするビデオの題名
     *  @type {string}
     *  @final
     */
    VIDEO_TITLE: '',

    /**
     *  ダウンロードした動画の仮ファイル名
     *  @type {string}
     *  @const
     */
    TMP_VIDEO_PATH: './yt_tmp_video',

    /**
     *  変換途中の音楽の仮ファイル名
     *  @type {string}
     *  @const
     */
    TMP_AUDIO_PATH1: './yt_tmp_audio1',
    TMP_AUDIO_PATH2: './yt_tmp_audio2',
    TMP_AUDIO_PATH3: './yt_tmp_audio3',

    /**
     *  動画のサムネイル画像の仮ファイル名
     *  @type {string}
     *  @const
     */
    TMP_IMAGE_PATH: './yt_tmp_image',

    /**
     *  出力後の動画形式
     *  @type {string}
     *  @final
     */
    OUTPUT_TYPE: '.mp3',

    /**
     *  出力先パス
     *  @type {string}
     *  @final
     */
    OUTPUT_PATH: '',

    /**
     *  直前の1行を削除する制御文字
     *  @type {string}
     *  @const
     */
    REMOVE_A_LINE: '\x1b[1A\x1bJ',

    /**
     *  ジャケット画像のURL
     *  @type {string}
     *  @final
     */
    URL_JACKET_IMAGE: '',

    CLIENT_ID: 'Gq4Nszci',

    metadatas: {
        acoustID: null,
        iTunes: null
    },

    mode: 0,
    query: '',

    /**
     *  セットアップを行う。具体的な処理は以下のとおり。
     *      + コマンドライン引数の解析
     *      + ジャケット画像URLの設定
     *      + 一時ファイル名へのタイムスタンプ付加
     *      + 一時ファイル名への拡張子付加
     */
    setup: function() {
        var videoID;

        switch (process.argv[2]) {
            case '-s':
                yt.mode = yt.MODE.ITUNESEARCH;
                yt.query = process.argv.slice(3).join(' ');
                break
            
            default:
                yt.mode = yt.MODE.NORMAL;
                videoID = process.argv[2];

                if (!videoID) {
                    throw new Error("Invalid videoID.");
                }
                if (videoID.substr(0, 4) === "http") {
                    yt.VIDEO_ID = yt.convertVideoPageURLtoVideoID(videoID);
                } else {
                    yt.VIDEO_ID = videoID;
                }

                yt.URL_JACKET_IMAGE = yt.convertVideoIDtoImageURL(yt.VIDEO_ID);

                yt.TMP_VIDEO_PATH += yt.TIMESTAMP;
                yt.TMP_AUDIO_PATH1 += yt.TIMESTAMP + yt.OUTPUT_TYPE;
                yt.TMP_AUDIO_PATH2 += yt.TIMESTAMP + yt.OUTPUT_TYPE;
                yt.TMP_AUDIO_PATH3 += yt.TIMESTAMP + yt.OUTPUT_TYPE;
                yt.TMP_IMAGE_PATH += yt.TIMESTAMP + '.jpg';
                break        
        }
    },

    /**
     *  メインルーチン
     *  1. 動画DL
     *  2. 音声抽出
     *  3. 声紋作成・音源認識
     *  4. acoustID, iTunesのデータベースと照合、メタデータ取得
     *  5. ジャケット画像DL
     *  6. ジャケット画像設定、アウトプット
     *  7. クリーンアップ
     */
    run: function() {
        switch (yt.mode) {
            case yt.MODE.NORMAL:
                yt.downloadVideoPage(yt.VIDEO_ID)
                    .then(yt.parseVideoPage)
                    .then(yt.getAvailableStream)
                    .then(yt.downloadVideo)
                    .then(yt.getMusicFromVideo)
                    .then(yt.createFingerPrint)
                    .then(yt.recognizeAudio)
                    .then(yt.searchMetaOnITunes)
                    .then(yt.downloadImage)
                    .then(yt.setAudioJacket)
                    .then(yt.setMetadatas)
                    .then(yt.cleanUp)
                    .then(function() {
                        console.log('');
                        console.log(Color.Blue2 + 'complete all successfully.' + Color.Normal);
                        console.log('');
                    })
                    .catch(function(err) {
                        console.error(err);
                        yt.cleanUp();
                        console.log('');
                    });
                break

            case yt.MODE.ITUNESEARCH:
                yt.metadatas.acoustID = {
                    title: yt.query,
                    artist: ''
                };
                yt.searchMetaOnITunes()
                    .then(function(){
                        console.log(yt.metadatas.iTunes);
                    });

                break
            }
    },

    /**
     *  動画ページのURLを動画IDに変換します
     *  @param {string} url 動画ページのURL
     */
    convertVideoPageURLtoVideoID: function(url) {
        var regVideoID = /v=([^&]+)/,
            ma;
        if (ma = url.match(regVideoID)) {
            return ma[1];
        } else {
            throw new Error('Invalid URL: ' + url);
        }
    },

    /**
     *  動画IDを動画ページのURLに変換します
     *  @param {string} videoID 動画ID
     *  @return {string} 動画ページのURL
     */
    convertVideoIDtoVideoPageURL: function(videoID) {
        return 'https://www.youtube.com/watch?v=' + videoID;
    },

    /**
     *  動画IDを動画のサムネイル画像のURLに変換します
     *  @param {string} videoID 動画ID
     *  @return {string} 動画画像のURL
     */
    convertVideoIDtoImageURL: function(videoID) {
        return 'https://i.ytimg.com/vi/' + videoID + '/hqdefault.jpg';
    },

    /**
     *  指定された動画ページのhtmlをダウンロードします
     *  @param {string} videoID 動画ID
     *  @return {Promise<string, Error>}
     *      DLに成功した場合はhtml本文を、失敗した場合はエラーオブジェクトを渡す。
     */
    downloadVideoPage: function(videoID) {
        var videoURL = yt.convertVideoIDtoVideoPageURL(videoID),
            defer = Promise.defer();

        console.log('');
        console.log(Color.Green + 'Download Video Page' + Color.Normal)
        console.log(Color.Red + 'videoID ' + Color.Normal + videoID);
        console.log(Color.Red + 'url ' + Color.Normal + videoURL);

        request.get(videoURL, function(err, res, body) {
            if (err) {
                defer.reject(err);
            } else {
                defer.resolve(body);
            }
        });

        return defer.promise;
    },

    /**
     *  動画ページのhtmlを解析します
     *  @param {string} html 動画ページのhtml
     *  @return {object[]} ストリーム情報オブジェクトの配列
     */
    parseVideoPage: function(html) {
        var regConfig = /ytplayer.config = ({.*?});/,
            regTitle = /<title>([^<]*)<\/title>/,
            maConfig = html.match(regConfig),
            maTitle = html.match(regTitle),
            config, urlEncodedFormatStreamMap, formatStreamMap;

        console.log('');
        console.log(Color.Green + 'Parse Video Page' + Color.Normal);

        if (!maConfig) {
            throw new Error("ytplayer.config is not found.");
        }

        config = JSON.parse(maConfig[1]);
        yt.VIDEO_TITLE = maTitle[1].replace(" - YouTube", "");
        yt.OUTPUT_PATH = './' + yt.escapeCmd(yt.VIDEO_TITLE, true) + yt.OUTPUT_TYPE;

        console.log(Color.Red + 'title ' + Color.Normal + yt.VIDEO_TITLE);

        urlEncodedFormatStreamMap = config.args.url_encoded_fmt_stream_map.split(",");
        formatStreamMap = urlEncodedFormatStreamMap.map(function(encodedStream) {
            var stream = yt.decodeURLParams(encodedStream);
            stream.type = stream.type.split(";")[0];
            return stream;
        });

        return formatStreamMap
    },

    /**
     *  URLパラメータをオブジェクトにデコードする
     *  @param {string} encoded エンコード済みのURLパラメータ文字列
     *  @return {Object} デコードされたパラメータオブジェクト
     */
    decodeURLParams: function(encoded) {
        var params = encoded.split("&"),
            result = {};

        params.forEach(function(param) {
            var keyVal = param.split("=");
            result[keyVal[0]] = decodeURIComponent(keyVal[1]);
        });

        return result;
    },

    /**
     *  動画のメタ情報からダウンロード可能なストリームを検索する。
     *  @param {Object} videoMetaData 動画のメタ情報。
     *      parseVideoPageによって取得できる。
     *  @return {Object} ストリーム情報オブジェクト
     */
    getAvailableStream: function(streams) {
        var stream =
            yt.findStreamByType(streams, "video/mp4") ||
            yt.findStreamByType(streams, "video/x-flv") ||
            null;

        if (!stream) {
            throw new Error("Available stream is not found.");
        }

        console.log('');
        console.log(Color.Green + 'Select Video Stream' + Color.Normal)
        console.log(Color.Red + 'type ' + Color.Normal + stream.type);
        console.log(Color.Red + 'url ' + Color.Normal + stream.url);

        return stream;
    },

    /**
     *  与えられたストリーム一覧から指定されたタイプのストリームを検索する
     *  @param {Object[]} streams ストリーム一覧。
     *      オブジェクトの形式はparseVideoPageと同様
     *  @param {string} type ストリームの形式
     *  @return {Object} ストリーム情報オブジェクト。
     *      条件に該当するストリームが存在しない場合はnullを返す。
     */
    findStreamByType: function(streams, type) {
        for (var i = 0, max = streams.length; i < max; i++) {
            if (streams[i].type !== type) continue;
            return streams[i];
        }
        return null;
    },

    /**
     *  指定されたストリームから動画を一時ファイルへダウンロードする。
     *  @param {Object} streamInfo ストリーム情報オブジェクト。
     *  @return {Promise<null, Error>} プロミスオブジェクト。
     *      成功時には引数は無し、失敗時にはエラーオブジェクトが渡される。
     */
    downloadVideo: function(streamInfo) {
        var stream = request(streamInfo.url),
            completeSize = 0,
            percent = -1,
            defer = Promise.defer(),
            maxSize;

        console.log('');
        console.log(Color.Green + 'Download Video' + Color.Normal);
        yt.showProgressGage(0);

        stream.pipe(fs.createWriteStream(yt.TMP_VIDEO_PATH));

        stream
            .once('data', function() {
                maxSize = Number(stream.response.headers['content-length']);
            })
            .on('data', function(buf) {
                var _percent;

                completeSize += buf.length;
                _percent = parseInt(completeSize / maxSize * 100);

                if (_percent > percent) {
                    percent = _percent;
                    process.stdout.write(yt.REMOVE_A_LINE);
                    yt.showProgressGage(percent);
                }
            })
            .on('end', function() {
                defer.resolve();
            })
            .on('error', function(err) {
                defer.reject(err);
            });

        return defer.promise;
    },

    /**
     *  標準出力にプログレスバーを印字する。
     *  @param {number} percent プログレスバーの値(0~100)
     */
    showProgressGage: function(percent) {
        var maxColumns = process.stdout.columns - 10,
            gageColumns = parseInt(maxColumns * percent / 100),
            spaceColumns = maxColumns - gageColumns;

        var gage = new Array(gageColumns + 1).join("#"),
            space = new Array(spaceColumns + 1).join("."),
            label = ("  " + percent).substr(-3) + "%";

        console.log(Color.Blue + gage + Color.Normal + space + " " + label);
    },

    /**
     *  動画ファイルから音楽だけ抜き出す。
     *  @return {Promise<null, Error>}
     *      成功した場合は引数なし、失敗した場合はエラーオブジェクトを渡します。
     */
    getMusicFromVideo: function() {
        var command =
            'ffmpeg -y -i {{videoPath}} -vn {{audioPath1}};' +
            'ffmpeg -y -i {{audioPath1}} -vn -acodec copy {{audioPath2}}',
            defer = Promise.defer(),
            videoPath = yt.TMP_VIDEO_PATH,
            audioPath1 = yt.TMP_AUDIO_PATH1,
            audioPath2 = yt.TMP_AUDIO_PATH2;

        console.log('');
        console.log(Color.Green + 'Extract Audio From Video' + Color.Normal);
        console.log(Color.Red + 'video ' + Color.Normal + yt.unescapeCmd(videoPath));
        console.log(Color.Red + 'audio ' + Color.Normal + yt.unescapeCmd(audioPath2));

        command = command
            .replace(/{{videoPath}}/g, videoPath)
            .replace(/{{audioPath1}}/g, audioPath1)
            .replace(/{{audioPath2}}/g, audioPath2);

        exec(command, function(err) {
            if (err) {
                return defer.reject(err);
            }

            defer.resolve();
        });

        return defer.promise;
    },

    /**
     *  音楽識別用のフィンガープリントを作成する
     *  @return {Promise<{
     *      duration: string,
     *      fingerPrint: string
     *  }, Error>} プロミスオブジェクト。
     *      成功時にはフィンガープリントオブジェクト、失敗時にはエラーオブジェクトが渡される。
     */
    createFingerPrint: function() {
        var command = 'fpcalc {{audioPath2}}',
            defer = Promise.defer(),
            audioPath2 = yt.TMP_AUDIO_PATH2;

        console.log('');
        console.log(Color.Green + 'Recognize Music Metadata' + Color.Normal);

        command = command
            .replace('{{audioPath2}}', audioPath2);

        exec(command, function(err, stdout, stderr) {
            if (err) {
                return defer.reject(err);
            }

            var lines = stdout.split('\n'),
                duration = lines[1].slice(9),
                fingerPrint = lines[2].slice(12);

            defer.resolve({
                duration: duration,
                fingerPrint: fingerPrint
            });
        });

        return defer.promise;
    },

    /**
     *  フィンガープリントを元に音楽を識別する
     *  @param {{
     *      duration: string,
     *      fingerPrint: string
     *  }} fingerPrint フィンガープリントオブジェクト。
     *  @return {Promise<Object|null, Error>} プロミスオブジェクト。
     *      音楽が識別できた場合はObject、識別できなかった場合はnullを、
     *      識別途中にエラーが発生した場合はエラーオブジェクトが渡される。
     */
    recognizeAudio: function(fingerPrint) {
        var url = 'http://api.acoustid.org/v2/lookup?client={{client}}&meta={{meta}}&duration={{duration}}&fingerprint={{fingerprint}}',
            url2 = 'http://api.acoustid.org/v2/lookup?client={{client}}&meta={{meta}}&trackid={{trackid}}'
        defer = Promise.defer();

        url = url
            .replace('{{client}}', yt.CLIENT_ID)
            .replace('{{meta}}', 'recordings+releasegroups+releases+tracks')
            .replace('{{duration}}', fingerPrint.duration)
            .replace('{{fingerprint}}', fingerPrint.fingerPrint);

        new Promise(function(resolve, reject) {
            request(url, function(err, res, body) {
                if (err) {
                    return reject(err);
                }

                resolve(JSON.parse(body));
            });
        })
            .then(function(data) {
                if (data.status !== 'ok' || data.results.length === 0) {
                    return null;
                }

                if (data.results[0].recordings) {
                    return data
                }

                url2 = url2
                    .replace('{{client}}', yt.CLIENT_ID)
                    .replace('{{meta}}', 'recordings+releasegroups+releases+tracks')
                    .replace('{{trackid}}', data.results[0].id);

                return new Promise(function(resolve, reject) {
                    request(url2, function(err, res, body) {
                        if (err) {
                            return reject(err);
                        }

                        resolve(JSON.parse(body));
                    });
                });
            })
            .then(function(data) {
                var result, recording, releasegroup, release, medium, track;

                if (!data || !data.results[0].recordings) {
                    console.log('The music is not found on the acoustID database.');
                    return defer.resolve(null);
                }

                result = data.results[0];
                recording = result.recordings[0];
                releasegroup = recording.releasegroups.filter(function(releasegroup) {
                    return releasegroup.type === 'Single'
                })[0] || recording.releasegroups[0];
                release = releasegroup.releases.filter(function(release){
                    return release.title === releasegroup.title
                })[0] || releasegroup.releases[0];
                medium = release.mediums[0];
                track = medium.tracks[0];

                yt.metadatas.acoustID = {
                    title: track.title,
                    artist: track.artists.reduce(function(result, artist) {
                        return result += artist.name + (artist.joinphrase || '')
                    }, ''),
                    album: releasegroup.title,
                    album_artist: releasegroup.artists.reduce(function(result, artist) {
                        return result += artist.name + (artist.joinphrase || '')
                    }, ''),
                    track: track.position + '/' + release.track_count,
                    disc: medium.position + '/' + release.mediumcount,
                };
                yt.OUTPUT_PATH = yt.escapeCmd(track.title, true) + yt.OUTPUT_TYPE;

                defer.resolve(yt.metadatas.acoustID.title + ' ' + yt.metadatas.acoustID.artist);
            })
            .catch(function(err) {
                defer.reject(err);
            })

        return defer.promise
    },

    /**
     *  iTunesのデータベースを検索しジャケット画像のURLを設定する
     *  @param {Object} metadata recognizeAudioで得られたメタ情報
     *  @return {Promise<null, Error>} プロミスオブジェクト。
     *      成功時には引数はなし、失敗時にはエラーオブジェクトが渡される。
     */
    searchMetaOnITunes: function(query) {
        var url = 'http://ax.itunes.apple.com/WebObjects/MZStoreServices.woa/wa/wsSearch?term={{term}}&country=JP&entity=musicTrack',
            requestSearchQuery = function(){
                console.log('');
                console.log('Please input search Query,\nor if you want search no more, press ' +
                    Color.Blue + '<Enter>' + Color.Normal + 
                    ' without input anything.');

                return yt.inputFromStdIn()
                    .then(function(input){
                        console.log('');
                        return yt.searchMetaOnITunes(input || false);
                    });
            };

        if (query === false) {
            console.log('cancel');
            yt.metadatas.acoustID = {
                artist: 'From Youtube',
                album: 'From Youtube'
            };
            return;
        } else if (!query) {
            return requestSearchQuery();
        }

        url = url
            .replace('{{term}}', encodeURIComponent(query));

        console.log(Color.Red + 'search ' + Color.Normal + query);

        return new Promise(function(resolve, reject){
            request(url, function(err, res, body) {
                var data;
                if (err) {
                    return reject(err);
                }

                data = JSON.parse(body);

                if (data.resultCount === 0) {
                    console.log(Color.Red + 'error ' + Color.Normal + 'This music is not found on the iTunes database.');
                    resolve(requestSearchQuery());
                    return
                }

                yt.metadatas.iTunes = data;
                resolve(yt.selectMeta());
            });
        })
    },

    /**
     *  メタデータから一つを選択する。
     */
    selectMeta: function() {
        var metaItunes = yt.metadatas.iTunes,
            results, i, max, result;


        if (!metaItunes) {
            return
        }
        results = metaItunes.results;

        for (i = 0, max = results.length; i < max; i++) {
            result = results[i];

            console.log('');
            console.log(Color.Red + (i + 1) + Color.Normal)
            console.log(Color.Red + 'title  ' + Color.Normal + result.trackName);
            console.log(Color.Red + 'artist ' + Color.Normal + result.artistName);
            console.log(Color.Red + 'album  ' + Color.Normal + result.collectionName);
        }

        var didSelectMeta = function(data) {
            var selectedIndex, selectedItem;
                
            if (!data) {
                yt.metadatas.iTunes = null;
                return yt.searchMetaOnITunes();
            }

            selectedIndex = parseInt(data),
            selectedItem = results[selectedIndex - 1];

            if (!selectedItem) {
                console.log('Invalid Value.');
                console.log('');
                console.log('Please input correct data number,\nor if you want search for other query, press ' + 
                        Color.Blue + '<Enter>' + Color.Normal + 
                        ' without input anything.');
                return yt.inputFromStdIn()
                    .then(didSelectMeta);
            }

            process.stdin.pause();
            yt.metadatas.acoustID = {
                title: selectedItem.trackName,
                artist: selectedItem.artistName,
                album: selectedItem.collectionName,
                album_artist: selectedItem.collectionArtistName || selectedItem.artistName,
                disc: selectedItem.discNumber + '/' + selectedItem.discCount,
                track: selectedItem.trackNumber + '/' + selectedItem.trackCount,
            };
            yt.OUTPUT_PATH = yt.escapeCmd(selectedItem.trackName, true) + yt.OUTPUT_TYPE;

            return
        };

        console.log('');
        console.log('Please input correct data number,\nor if you want search for other query, press ' + 
                Color.Blue + '<Enter>' + Color.Normal + 
                ' without input anything.');

        return yt.inputFromStdIn()
            .then(didSelectMeta);
    },

    inputFromStdIn: function() {
        var defer = Promise.defer();

        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', function(chunk) {
            process.stdin.pause();
            process.stdout.write(Color.Normal);
            defer.resolve(chunk.trim().split('\n')[0]);
        });

        process.stdout.write(Color.Yellow + '>> ');

        return defer.promise;
    },

    /**
     *  シェルスクリプトで安全な形に文字列をエスケープする
     *  @param {string} input 元となる文字列
     *  @param {boolean} [flagRemove=false] エスケープ方法。
     *      trueの場合、使用不可能な文字は削除する。
     *      falseの場合、エスケープのみ行い、削除は行わない。
     *  @return {string} エスケープされた文字列
     */
    escapeCmd: function(input, flagRemove) {
        var escaped =  ('' + input).replace(/[\;\&\(\)\|\^\<\>\?\*\[\]\$\`\'\"\\\!\{\}\.\n\t\s]/g, function(w) {
            return '\\' + w
        }).replace(/([\/]|&[^;]*;)/g, function(w) {
            return flagRemove ? '' : '\\' + w
        });

        while (escaped.split('.').length > 2) {
            escaped = escaped.replace(/\./, '');
        }

        return escaped
    },

    /**
     *  ESCエスケープされた文字列を元に戻す。
     *  @param {string} input 元となる文字列
     *  @return {string} 復元された文字列
     */
    unescapeCmd: function(input, flagRemove) {
        return ('' + input).replace(/\\/g, '');
    },

    /**
     *  指定された動画のサムネイル画像をダウンロードする。
     *  @return {Promise<null, Error>} プロミスオブジェクト。
     *      成功時には引数は無し、失敗時にはエラーオブジェクトが渡される。
     */
    downloadImage: function() {
        var url = yt.URL_JACKET_IMAGE,
            stream = request(url),
            percent = -1,
            defer = Promise.defer();

        if (yt.metadatas.iTunes) {
            return;
        }

        console.log('');
        console.log(Color.Green + 'Download Image' + Color.Normal);

        stream.pipe(fs.createWriteStream(yt.TMP_IMAGE_PATH));

        stream
            .on('end', function() {
                console.log('done.');
                defer.resolve();
            }).on('error', function(err) {
                defer.reject(err);
            });

        return defer.promise;
    },

    /**
     *  音楽にジャケットを設定する
     *  @return {Promise<null, Error>}
     *      成功した場合は引数なし、失敗した場合はエラーオブジェクトを渡します。
     */
    setAudioJacket: function() {
        var command = 'ffmpeg -y -i {{audioPath2}} -i {{imagePath}} -acodec copy -vcodec mjpeg -map 0:0 -map 1:0 {{audioPath3}}',
            defer = Promise.defer(),
            audioPath2 = yt.TMP_AUDIO_PATH2,
            imagePath = yt.TMP_IMAGE_PATH,
            audioPath3 = yt.TMP_AUDIO_PATH3;

        //サムネイルを設定する必要がない場合
        if (yt.metadatas.iTunes) {
            command = 'cp {{audioPath2}} {{audioPath3}}';
        }

        console.log('');
        console.log(Color.Green + 'Set Audio Jacket Image' + Color.Normal);
        console.log(Color.Red + 'audio ' + Color.Normal + yt.unescapeCmd(audioPath2));
        console.log(Color.Red + 'image ' + Color.Normal + yt.unescapeCmd(imagePath));
        console.log(Color.Red + 'output ' + Color.Normal + yt.unescapeCmd(audioPath3));

        command = command
            .replace(/{{audioPath2}}/g, audioPath2)
            .replace(/{{imagePath}}/g, imagePath)
            .replace(/{{audioPath3}}/g, audioPath3);

        exec(command, function(err) {
            if (err) {
                return defer.reject(err);
            }

            defer.resolve();
        });

        return defer.promise;
    },

    /**
     *  mp3データにメタデータを埋め込む
     *  @param {Object<string, string>} metadata 埋め込むメタデータのkey-valueペア
     *  @return {Promise<null, Error>} プロミスオブジェクト。
     *      成功した場合は引数無し、失敗時にはエラーオブジェクトが渡される。
     */
    setMetadatas: function() {
        var command = 'ffmpeg -i {{audioPath3}} -acodec copy -vcodec copy {{metadatas}} {{outputPath}}',
            audioPath3 = yt.TMP_AUDIO_PATH3,
            outputPath = yt.OUTPUT_PATH,
            metas = [],
            defer = Promise.defer(),
            metaAcoustID = yt.metadatas.acoustID,
            metadataStr;

        console.log('');
        console.log(Color.Green + 'Set Audio Metadata' + Color.Normal);
        console.log(Color.Red + 'audio ' + Color.Normal + yt.unescapeCmd(audioPath3));
        console.log(Color.Red + 'output ' + Color.Normal + yt.unescapeCmd(outputPath));

        for (var key in metaAcoustID) {
            metas.push('-metadata ' + key + '=' + yt.escapeCmd(metaAcoustID[key]));
        }
        metadataStr = metas.join(' ');

        command = command
            .replace(/{{metadatas}}/g, metadataStr)
            .replace(/{{audioPath3}}/g, audioPath3)
            .replace(/{{outputPath}}/g, outputPath);

        exec(command, function(err, stdout, stderr) {
            if (err) {
                return defer.reject(err);
            }

            return defer.resolve();
        });

        return defer.promise
    },

    /**
     *  クリーンアップを行う。具体的な処理は以下のとおり。
     *      + 一時ファイルの削除
     *  @return {Promise<null, Error>} プロミスオブジェクト。
     *      成功時には引数は無し、失敗時にはエラーオブジェクトが渡される。
     */
    cleanUp: function() {
        var defer = Promise.defer();

        console.log('');
        console.log(Color.Green + 'Clean Up' + Color.Normal);

        yt.unlink(yt.TMP_VIDEO_PATH)
            .then(function() {
                return yt.unlink(yt.TMP_AUDIO_PATH1);
            }, function() {
                return yt.unlink(yt.TMP_AUDIO_PATH1);
            })
            .then(function() {
                return yt.unlink(yt.TMP_AUDIO_PATH2);
            }, function() {
                return yt.unlink(yt.TMP_AUDIO_PATH2);
            })
            .then(function() {
                return yt.unlink(yt.TMP_AUDIO_PATH3);
            }, function() {
                return yt.unlink(yt.TMP_AUDIO_PATH3);
            })
            .then(function() {
                if (yt.metadatas.iTunes) {
                    return
                }
                return yt.unlink(yt.TMP_IMAGE_PATH);
            }, function() {
                if (yt.metadatas.iTunes) {
                    return
                }
                return yt.unlink(yt.TMP_IMAGE_PATH);
            })
            .then(function() {
                defer.resolve()
            }, function() {
                defer.resolve()
            })

        return defer.promise
    },

    /**
     *  プロミスパターンによりファイルを同期的に削除する。
     *  @param {string} filePath 削除するファイルのパス
     *  @return {Promise<null, Error>} プロミスオブジェクト。
     *      成功時には引数は無し、失敗時にはエラーオブジェクトが渡される。
     */
    unlink: function(filePath) {
        var defer = Promise.defer();

        console.log(Color.Red + 'unlink ' + Color.Normal + filePath);

        fs.unlink(filePath, function(err) {
            if (err) {
                return defer.reject(err);
            }

            defer.resolve();
        });

        return defer.promise
    }
};

yt.setup();
yt.run();