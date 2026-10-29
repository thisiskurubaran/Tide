---
app: APP_SLUG
title: APP_NAME
permalink: /APP_SLUG/
---

{% assign app = site.data.apps | where: "slug", "APP_SLUG" | first %}
<div class="hero">
  {% if app.icon %}<img src="{{ app.icon }}" alt="">{% else %}<span class="mark">{{ app.name | slice: 0 }}</span>{% endif %}
  <div>
    <h1>{{ app.name }}</h1>
    <div>For {{ app.platforms }}</div>
  </div>
</div>

{{ app.tagline }}
{: .lead}

<p class="links">
  <a class="button" href="/APP_SLUG/privacy/">Privacy Policy</a>
  <a class="button" href="/APP_SLUG/support/">Support</a>
</p>
