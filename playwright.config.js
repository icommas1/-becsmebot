const { defineConfig, devices }=require("@playwright/test");
module.exports=defineConfig({
  testDir:"test/e2e", fullyParallel:true, forbidOnly:!!process.env.CI,
  retries:process.env.CI?1:0, workers:process.env.CI?2:undefined,
  reporter:[["list"],["html",{open:"never"}]],
  use:{baseURL:"http://127.0.0.1:4173",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[
    {name:"iphone-webkit",use:{...devices["iPhone 13"],browserName:"webkit"}},
    {name:"mobile-chromium",use:{...devices["Pixel 7"],browserName:"chromium"}},
    {name:"desktop-chromium",use:{...devices["Desktop Chrome"],browserName:"chromium"}}
  ],
  webServer:{command:"node test/fixtures/server.js",url:"http://127.0.0.1:4173/health",reuseExistingServer:false,timeout:30000}
});
