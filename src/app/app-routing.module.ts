import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AppComponent } from './app.component';
import { StudentUploadComponent } from './answer-sheet/student-upload.component';

const routes: Routes = [
  { path: '', component: AppComponent },
  { path: 's/:token', component: StudentUploadComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
