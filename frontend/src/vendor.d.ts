declare module "*.css";

declare module "plotly.js-dist-min" {
  import * as Plotly from "plotly.js";
  export = Plotly;
}