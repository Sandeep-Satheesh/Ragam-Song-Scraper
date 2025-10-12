const {google} = require('googleapis');
const ytsr = require('ytsr');
const YT_API_KEY = process.env.YT_API_KEY || '';
async function searchYouTube(query){
  if(YT_API_KEY){
    try{
      const youtube = google.youtube({version:'v3', auth: YT_API_KEY});
      const resp = await youtube.search.list({ part: 'snippet', q: query, maxResults: 1, type: 'video' });
      const items = resp.data.items || [];
      if(items.length===0) return {id:null, url:null};
      const id = items[0].id.videoId;
      return { id, url: `https://www.youtube.com/watch?v=${id}` };
    }catch(e){
      console.warn('YouTube API error, falling back to ytsr:', e.message || e);
    }
  }
  try{
    const r = await ytsr(query, {limit: 5});
    const video = r.items && r.items.find(it=> it.type==='video');
    if(video) return { id: video.id, url: video.url };
  }catch(e){
    console.warn('ytsr error:', e.message || e);
  }
  return { id:null, url:null };
}
module.exports = { searchYouTube };
