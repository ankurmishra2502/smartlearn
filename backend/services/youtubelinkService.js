
const extractVideoId = (url) => {
    if (!url) {
        throw new Error("YouTube URL is required.");
    }

    const patterns = [
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?&]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?&]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([^?&]+)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);

        if (match && match[1]) {
            return match[1];
        }
    }

    throw new Error("Invalid YouTube URL.");
};

/**
 * Validate URL
 */
const isValidYoutubeUrl = (url) => {
    try {
        extractVideoId(url);
        return true;
    } catch {
        return false;
    }
};

module.exports = {
    extractVideoId,
    isValidYoutubeUrl
};