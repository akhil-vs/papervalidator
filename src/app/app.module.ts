import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AppComponent } from './app.component';

import {TabViewModule} from 'primeng/tabview';
import {TooltipModule} from 'primeng/tooltip';
import {OverlayPanelModule} from 'primeng/overlaypanel';
import {ToastModule} from 'primeng/toast';
import {SelectButtonModule} from 'primeng/selectbutton';
import {BlockUIModule} from 'primeng/blockui';
import {PanelModule} from 'primeng/panel';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    FormsModule,
    ReactiveFormsModule,
    TabViewModule,
    TooltipModule,
    OverlayPanelModule,
    ToastModule,
    SelectButtonModule,
    BlockUIModule,
    PanelModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
