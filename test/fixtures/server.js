const {browserFixtureApp}=require("./browser-app");
browserFixtureApp().then(app=>{
  const server=app.listen(4173,"127.0.0.1");
  for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>process.exit(0)));
}).catch(error=>{console.error(error);process.exit(1);});
