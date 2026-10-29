---
app: tide
title: Tide
permalink: /tide/
---

{% assign app = site.data.apps | where: "slug", "tide" | first %}
<div class="hero">
  <img src="{{ app.icon }}" alt="">
  <div>
    <h1>{{ app.name }}</h1>
    <div>For {{ app.platforms }}</div>
  </div>
</div>

{{ app.tagline }}
{: .lead}

<p class="links">
  <a class="button" href="/tide/privacy/">Privacy Policy</a>
  <a class="button" href="/tide/support/">Support</a>
</p>
