const axios = require("axios");

/**
 * Fetch YouTube Video Details
 */
const getYoutubeVideoDetails = async (videoId) => {
  try {
    const response = await axios.get(
      "https://www.googleapis.com/youtube/v3/videos",
      {
        params: {
          part: "snippet",
          id: videoId,
          key: process.env.YOUTUBE_API_KEY,
        },
      }
    );

    if (
      !response.data.items ||
      response.data.items.length === 0
    ) {
      throw new Error("Video not found.");
    }

    const video = response.data.items[0];

    return {
      videoId,
      title: video.snippet.title,
      channelTitle: video.snippet.channelTitle,
      thumbnail:
        video.snippet.thumbnails.maxres?.url ||
        video.snippet.thumbnails.high?.url ||
        video.snippet.thumbnails.medium?.url ||
        video.snippet.thumbnails.default?.url,
    };
  } catch (err) {
    console.error(
      "YouTube API Error:",
      err.response?.data || err.message
    );

    throw new Error("Unable to fetch YouTube video details.");
  }
};

module.exports = {
  getYoutubeVideoDetails,
};