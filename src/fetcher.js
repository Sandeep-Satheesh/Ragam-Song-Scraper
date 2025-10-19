const axios = require('axios');
const configs = require('./configs');

async function fetchHtml(url, timeout = 15000, maxRedirects = 10) {
  try {
    const resp = await axios.get(url, {
      headers: configs.DEFAULT_HEADERS,
      timeout,
      maxRedirects,            // follow redirects automatically
      followAllRedirects: true,
      responseType: 'text',
      validateStatus: status => status < 400
    });
    return { html: resp.data, finalUrl: resp.request?.res?.responseUrl || resp.config.url, status: resp.status, headers: resp.headers };
  } catch (err) {
    throw err;
  }
}

module.exports = { fetchHtml };
