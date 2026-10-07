### [Reading the response body](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#reading_the_response_body)

The `Response` interface provides a number of methods to retrieve the entire body contents in a variety of different formats:

- [`Response.arrayBuffer()`](https://developer.mozilla.org/en-US/docs/Web/API/Response/arrayBuffer)
- [`Response.blob()`](https://developer.mozilla.org/en-US/docs/Web/API/Response/blob)
- [`Response.formData()`](https://developer.mozilla.org/en-US/docs/Web/API/Response/formData)
- [`Response.json()`](https://developer.mozilla.org/en-US/docs/Web/API/Response/json)
- [`Response.text()`](https://developer.mozilla.org/en-US/docs/Web/API/Response/text)

These are all asynchronous methods, returning a [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) which will be fulfilled with the body content.

In this example, we fetch an image and read it as a [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob), which we can then use to create an object URL:

jsCopy

```
const image = document.querySelector("img");

const url = "flowers.jpg";

async function setImage() {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }
    const blob = await response.blob();
    const objectURL = URL.createObjectURL(blob);
    image.src = objectURL;
  } catch (e) {
    console.error(e);
  }
}
```

The method will throw an exception if the response body is not in the appropriate format: for example, if you call `json()` on a response that can't be parsed as JSON.
