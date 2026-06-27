const { YoutubeTranscript } = require("youtube-transcript");

/**
 * Fetch complete transcript from YouTube
 * @param {string} videoId
 * @returns {string}
 */
const getTranscript = async (videoId) => {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    if (!transcript || transcript.length === 0) {
      throw new Error("Transcript not available.");
    }

    const fullTranscript = transcript
      .map(item => item.text)
      .join(" ");

    return fullTranscript;

  } catch (err) {
    console.error("Transcript Error:", err.message);

    throw new Error(
      "Transcript not available for this YouTube video."
    );
  }
};

module.exports = {
  getTranscript
};