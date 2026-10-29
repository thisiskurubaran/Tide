---
title: Apps
permalink: /
---

# Apps

Privacy policies and support for my apps.
{: .lead}

<div class="apps">
{% for app in site.data.apps %}
  <div class="app">
    {% if app.icon %}<img src="{{ app.icon }}" alt="">{% else %}<span class="mark">{{ app.name | slice: 0 }}</span>{% endif %}
    <div>
      <h2><a href="/{{ app.slug }}/" style="color: inherit; text-decoration: none">{{ app.name }}</a></h2>
      <p>{{ app.tagline }}</p>
      <p class="links">
        <a class="button" href="/{{ app.slug }}/privacy/">Privacy Policy</a>
        <a class="button" href="/{{ app.slug }}/support/">Support</a>
      </p>
    </div>
  </div>
{% endfor %}
</div>

Questions about any of them: [thisiskurubaran@gmail.com](mailto:thisiskurubaran@gmail.com)
